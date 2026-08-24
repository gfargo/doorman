import { logger } from '../../logger'
import type { UnifiedRule, UnifiedIPRule } from '../../types/unified'
import type { CloudflareRule } from '../../types/cloudflare'

/**
 * Result of diffing native Cloudflare rules against their translated local
 * counterparts. `toAdd`/`toUpdate` are the *original* `UnifiedRule`s (not the
 * translated `CloudflareRule`s) so callers keep the lossless local data;
 * `toDelete` has no local counterpart, so it stays in Cloudflare's native form.
 */
export interface CloudflareRuleDiffResult {
  toAdd: UnifiedRule[]
  toUpdate: UnifiedRule[]
  toDelete: CloudflareRule[]
}

/**
 * Result of an optimized rule diff operation
 */
export interface OptimizedDiffResult<T> {
  toAdd: T[]
  toUpdate: T[]
  toDelete: T[]
  unchanged: number
  duration: number
}

/**
 * Options for the connection pool
 */
export interface ConnectionPoolOptions {
  /** Maximum number of concurrent connections (default: 6) */
  maxConnections: number
}

const DEFAULT_POOL_OPTIONS: ConnectionPoolOptions = {
  maxConnections: 6,
}

/**
 * Options for request deduplication
 */
export interface DeduplicationOptions {
  /** TTL for deduplication entries in ms (default: 5000) */
  ttl: number
  /** Maximum number of tracked in-flight requests (default: 100) */
  maxEntries: number
}

const DEFAULT_DEDUP_OPTIONS: DeduplicationOptions = {
  ttl: 5000,
  maxEntries: 100,
}

/**
 * Statistics for the optimizer
 */
export interface OptimizerStats {
  diffOperations: number
  diffTotalDuration: number
  earlyExits: number
  deduplicatedRequests: number
  pooledConnections: number
  chunkedOperations: number
}

/**
 * In-flight request entry for deduplication
 */
interface InFlightRequest<T> {
  promise: Promise<T>
  createdAt: number
}

/**
 * CloudflareOptimizer provides performance optimizations for Cloudflare operations:
 *
 * 1. Optimized rule diffing with hash-based comparison and early exit
 * 2. Connection pooling for HTTP request reuse
 * 3. Request deduplication to avoid redundant API calls
 * 4. Memory-efficient processing for large rule sets via streaming/chunking
 *
 * Requirements: 5.1 (30s sync), 5.6 (batch/parallelize API calls)
 */
export class CloudflareOptimizer {
  private stats: OptimizerStats = {
    diffOperations: 0,
    diffTotalDuration: 0,
    earlyExits: 0,
    deduplicatedRequests: 0,
    pooledConnections: 0,
    chunkedOperations: 0,
  }

  private poolOptions: ConnectionPoolOptions
  private dedupOptions: DeduplicationOptions

  /** In-flight request map for deduplication */
  private inFlightRequests = new Map<string, InFlightRequest<unknown>>()

  /** Hash cache to avoid recomputing hashes for unchanged rules */
  private hashCache = new Map<string, string>()

  /** Connection semaphore: tracks active connection count */
  private activeConnections = 0
  private connectionQueue: Array<() => void> = []

  constructor(poolOptions: Partial<ConnectionPoolOptions> = {}, dedupOptions: Partial<DeduplicationOptions> = {}) {
    this.poolOptions = { ...DEFAULT_POOL_OPTIONS, ...poolOptions }
    this.dedupOptions = { ...DEFAULT_DEDUP_OPTIONS, ...dedupOptions }
  }

  // ── Optimized Rule Diffing ──────────────────────────────────────────

  /**
   * Compute a fast hash for a rule object.
   * Uses a deterministic JSON serialization for consistent comparison.
   */
  public computeRuleHash(rule: UnifiedRule): string {
    // Build a canonical representation for hashing
    const canonical = this.canonicalizeRule(rule)

    // Use canonical string as cache key to avoid stale hashes
    // when the same rule ID has different content (e.g., during diffing)
    const cached = this.hashCache.get(canonical)
    if (cached) return cached

    const hash = this.simpleHash(canonical)
    this.hashCache.set(canonical, hash)
    return hash
  }

  /**
   * Optimized diff with early exit and hash-based comparison.
   *
   * Improvements over the base `optimizedDiff`:
   * - Early exit when both arrays are empty or identical references
   * - Hash-based equality check avoids deep JSON.stringify comparison
   * - Tracks unchanged count for reporting
   */
  public diffRules(local: UnifiedRule[], remote: UnifiedRule[]): OptimizedDiffResult<UnifiedRule> {
    const start = performance.now()
    this.stats.diffOperations++

    // Early exit: both empty
    if (local.length === 0 && remote.length === 0) {
      this.stats.earlyExits++
      return { toAdd: [], toUpdate: [], toDelete: [], unchanged: 0, duration: performance.now() - start }
    }

    // Early exit: same reference
    if (local === remote) {
      this.stats.earlyExits++
      return { toAdd: [], toUpdate: [], toDelete: [], unchanged: local.length, duration: performance.now() - start }
    }

    // Early exit: local empty means delete all remote
    if (local.length === 0) {
      this.stats.earlyExits++
      return { toAdd: [], toUpdate: [], toDelete: [...remote], unchanged: 0, duration: performance.now() - start }
    }

    // Early exit: remote empty means add all local
    if (remote.length === 0) {
      this.stats.earlyExits++
      return { toAdd: [...local], toUpdate: [], toDelete: [], unchanged: 0, duration: performance.now() - start }
    }

    // Build hash maps for O(n) comparison
    const remoteMap = new Map<string, { rule: UnifiedRule; hash: string }>()
    for (const rule of remote) {
      const key = rule.id || rule.name
      remoteMap.set(key, { rule, hash: this.computeRuleHash(rule) })
    }

    const localMap = new Map<string, boolean>()
    const toAdd: UnifiedRule[] = []
    const toUpdate: UnifiedRule[] = []
    let unchanged = 0

    for (const localRule of local) {
      const key = localRule.id || localRule.name
      localMap.set(key, true)

      const remoteEntry = remoteMap.get(key)
      if (!remoteEntry) {
        toAdd.push(localRule)
      } else {
        const localHash = this.computeRuleHash(localRule)
        if (localHash !== remoteEntry.hash) {
          toUpdate.push(localRule)
        } else {
          unchanged++
        }
      }
    }

    const toDelete: UnifiedRule[] = []
    for (const [key, entry] of remoteMap) {
      if (!localMap.has(key)) {
        toDelete.push(entry.rule)
      }
    }

    const duration = performance.now() - start
    this.stats.diffTotalDuration += duration

    logger.debug(
      `Optimized diff: +${toAdd.length} ~${toUpdate.length} -${toDelete.length} =${unchanged} (${duration.toFixed(1)}ms)`,
    )

    return { toAdd, toUpdate, toDelete, unchanged, duration }
  }

  /**
   * Diff local rules against remote rules in Cloudflare's *native* space
   * (comparing real wirefilter expressions) instead of `diffRules`'s unified
   * space. `RuleTranslator.cloudflareToUnified` always returns
   * `conditions: []` (expression parsing isn't implemented), so a hash keyed
   * on `conditions` — `diffRules`'s approach, fed a remote array translated
   * through `cloudflareToUnified` — could never hash-equal a local rule with
   * real conditions: every synced rule showed as `toUpdate` forever, even
   * with nothing to sync. Comparing the real `expression` string on both
   * sides (translating local rules to Cloudflare's format, never translating
   * remote rules to unified) sidesteps that entirely.
   *
   * Keying matches `diffRules`'s existing semantics exactly (local
   * `rule.id || rule.name` against remote `CloudflareRule.id`, which is
   * always what `cloudflareToUnified` sets as the unified rule's own `id`) —
   * this method changes what counts as "equal" for a matched pair, not how
   * pairs are matched.
   */
  public diffCloudflareRules(
    local: Array<{ rule: UnifiedRule; translated: CloudflareRule }>,
    remote: CloudflareRule[],
  ): CloudflareRuleDiffResult {
    const remoteById = new Map(remote.map((r) => [r.id, r]))
    const localKeys = new Set<string>()
    const toAdd: UnifiedRule[] = []
    const toUpdate: UnifiedRule[] = []

    for (const { rule, translated } of local) {
      const key = rule.id || rule.name
      localKeys.add(key)
      const remoteRule = remoteById.get(key)
      if (!remoteRule) {
        toAdd.push(rule)
      } else if (!this.cloudflareRulesEqual(translated, remoteRule)) {
        toUpdate.push(rule)
      }
    }

    const toDelete: CloudflareRule[] = []
    for (const [key, remoteRule] of remoteById) {
      if (!localKeys.has(key)) {
        toDelete.push(remoteRule)
      }
    }

    // Position drift. Cloudflare has no per-rule priority field — a rule's
    // index in the ruleset array *is* its precedence — and `local` arrives
    // already sorted by `UnifiedRule.priority`. So a config whose only
    // change is a reordering produces identical rule *content* on both
    // sides and would otherwise diff clean, even though syncing it would
    // rewrite the live evaluation order (a security-relevant change: a
    // broad `allow` moving ahead of a narrow `block` inverts the policy).
    //
    // Compared over the rules common to both sides, in their respective
    // orders — rules being added or deleted are excluded, since their
    // arrival/removal shifts indices without anything having been
    // deliberately reordered.
    const alreadyUpdating = new Set(toUpdate.map((r) => r.id || r.name))
    const desiredCommonOrder = local.map(({ rule }) => rule.id || rule.name).filter((key) => remoteById.has(key))
    const remoteCommonOrder = remote.map((r) => r.id).filter((key) => localKeys.has(key))

    desiredCommonOrder.forEach((key, index) => {
      if (remoteCommonOrder[index] === key || alreadyUpdating.has(key)) {
        return
      }
      const moved = local.find(({ rule }) => (rule.id || rule.name) === key)
      if (moved) {
        toUpdate.push(moved.rule)
        alreadyUpdating.add(key)
      }
    })

    return { toAdd, toUpdate, toDelete }
  }

  /**
   * Compare two native Cloudflare rules on the fields that actually
   * determine wire behavior. `id`/`last_updated`/`version`/`ref`/`categories`
   * are deliberately excluded — they're either identity (already used for
   * matching, not equality) or metadata Cloudflare manages itself.
   *
   * Public so CloudflareFirewallService.getChanges can reuse it directly for
   * managed rule groups (#183) — those diff in native space too, for the
   * same reason custom rules do (see diffCloudflareRules' doc comment), so
   * duplicating this comparison would just be two copies to keep in sync.
   */
  public cloudflareRulesEqual(a: CloudflareRule, b: CloudflareRule): boolean {
    return (
      a.action === b.action &&
      a.expression === b.expression &&
      (a.enabled ?? true) === (b.enabled ?? true) &&
      (a.description || '') === (b.description || '') &&
      JSON.stringify(a.ratelimit ?? null) === JSON.stringify(b.ratelimit ?? null) &&
      JSON.stringify(a.action_parameters ?? null) === JSON.stringify(b.action_parameters ?? null)
    )
  }

  /**
   * Optimized diff for IP rules with hash-based comparison.
   */
  public diffIPRules(local: UnifiedIPRule[], remote: UnifiedIPRule[]): OptimizedDiffResult<UnifiedIPRule> {
    const start = performance.now()

    // Early exit: both empty
    if (local.length === 0 && remote.length === 0) {
      this.stats.earlyExits++
      return { toAdd: [], toUpdate: [], toDelete: [], unchanged: 0, duration: performance.now() - start }
    }

    if (local.length === 0) {
      this.stats.earlyExits++
      return { toAdd: [], toUpdate: [], toDelete: [...remote], unchanged: 0, duration: performance.now() - start }
    }

    if (remote.length === 0) {
      this.stats.earlyExits++
      return { toAdd: [...local], toUpdate: [], toDelete: [], unchanged: 0, duration: performance.now() - start }
    }

    // Use IP as the key for IP rules
    const remoteMap = new Map<string, UnifiedIPRule>()
    for (const rule of remote) {
      remoteMap.set(rule.ip, rule)
    }

    const localSet = new Set<string>()
    const toAdd: UnifiedIPRule[] = []
    const toUpdate: UnifiedIPRule[] = []
    let unchanged = 0

    for (const localRule of local) {
      localSet.add(localRule.ip)
      const remoteRule = remoteMap.get(localRule.ip)
      if (!remoteRule) {
        toAdd.push(localRule)
      } else if (localRule.action !== remoteRule.action) {
        toUpdate.push(localRule)
      } else {
        unchanged++
      }
    }

    const toDelete: UnifiedIPRule[] = []
    for (const [ip, rule] of remoteMap) {
      if (!localSet.has(ip)) {
        toDelete.push(rule)
      }
    }

    const duration = performance.now() - start
    return { toAdd, toUpdate, toDelete, unchanged, duration }
  }

  // ── Connection Pooling ──────────────────────────────────────────────

  /**
   * Acquire a connection slot from the pool.
   * If the pool is full, the caller waits until a slot is released.
   */
  public async acquireConnection(): Promise<void> {
    if (this.activeConnections < this.poolOptions.maxConnections) {
      this.activeConnections++
      this.stats.pooledConnections++
      return
    }

    // Wait for a slot to become available
    return new Promise<void>((resolve) => {
      this.connectionQueue.push(() => {
        this.activeConnections++
        this.stats.pooledConnections++
        resolve()
      })
    })
  }

  /**
   * Release a connection slot back to the pool.
   */
  public releaseConnection(): void {
    this.activeConnections--

    // Wake up the next waiter if any
    if (this.connectionQueue.length > 0) {
      const next = this.connectionQueue.shift()!
      next()
    }
  }

  /**
   * Execute an async operation with connection pooling.
   * Automatically acquires and releases a connection slot.
   */
  public async withConnection<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireConnection()
    try {
      return await operation()
    } finally {
      this.releaseConnection()
    }
  }

  /**
   * Execute multiple operations with connection pooling.
   * Operations run concurrently up to the pool's maxConnections limit.
   */
  public async executePooled<T>(operations: Array<() => Promise<T>>): Promise<T[]> {
    if (operations.length === 0) return []

    const results: T[] = new Array(operations.length)
    const executing: Promise<void>[] = []

    for (let i = 0; i < operations.length; i++) {
      const index = i
      const op = operations[index]!
      const task = this.withConnection(async () => {
        results[index] = await op()
      })
      executing.push(task)
    }

    await Promise.all(executing)
    return results
  }

  // ── Request Deduplication ───────────────────────────────────────────

  /**
   * Execute a request with deduplication.
   * If an identical request is already in-flight, returns the same promise
   * instead of making a duplicate API call.
   */
  public async deduplicateRequest<T>(key: string, operation: () => Promise<T>): Promise<T> {
    // Clean up expired entries
    this.cleanupExpiredRequests()

    // Check for in-flight request
    const existing = this.inFlightRequests.get(key)
    if (existing && Date.now() - existing.createdAt < this.dedupOptions.ttl) {
      this.stats.deduplicatedRequests++
      logger.debug(`Request deduplicated: ${key}`)
      return existing.promise as Promise<T>
    }

    // Create new in-flight entry
    const promise = operation().finally(() => {
      // Remove from in-flight after completion
      this.inFlightRequests.delete(key)
    })

    this.inFlightRequests.set(key, {
      promise,
      createdAt: Date.now(),
    })

    return promise
  }

  /**
   * Generate a deduplication key for a request.
   */
  public static requestKey(method: string, path: string, body?: string): string {
    const parts = [method.toUpperCase(), path]
    if (body) {
      parts.push(body)
    }
    return parts.join(':')
  }

  /**
   * Clean up expired in-flight request entries.
   */
  private cleanupExpiredRequests(): void {
    const now = Date.now()
    for (const [key, entry] of this.inFlightRequests) {
      if (now - entry.createdAt > this.dedupOptions.ttl) {
        this.inFlightRequests.delete(key)
      }
    }

    // Enforce max entries limit
    if (this.inFlightRequests.size > this.dedupOptions.maxEntries) {
      const entries = Array.from(this.inFlightRequests.entries())
      entries.sort((a, b) => a[1].createdAt - b[1].createdAt)
      const toRemove = entries.slice(0, entries.length - this.dedupOptions.maxEntries)
      for (const [key] of toRemove) {
        this.inFlightRequests.delete(key)
      }
    }
  }

  // ── Memory-Efficient Processing ─────────────────────────────────────

  /**
   * Process a large array of rules in chunks to limit peak memory usage.
   * Applies a transform function to each chunk and collects results.
   */
  public async processInChunks<T, R>(
    items: T[],
    chunkSize: number,
    processor: (chunk: T[], chunkIndex: number) => Promise<R[]>,
  ): Promise<R[]> {
    if (items.length === 0) return []

    this.stats.chunkedOperations++
    const results: R[] = []
    const totalChunks = Math.ceil(items.length / chunkSize)

    if (items.length > chunkSize) {
      logger.debug(`Processing ${items.length} items in ${totalChunks} chunks of ${chunkSize}`)
    }

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize)
      const chunkIndex = Math.floor(i / chunkSize)
      const chunkResults = await processor(chunk, chunkIndex)
      results.push(...chunkResults)
    }

    return results
  }

  /**
   * Estimate memory usage for a rule set in bytes.
   * Useful for deciding whether to use chunked processing.
   */
  public estimateMemoryUsage(rules: UnifiedRule[]): number {
    if (rules.length === 0) return 0

    // Sample a few rules to estimate average size
    const sampleSize = Math.min(10, rules.length)
    let totalSampleSize = 0

    for (let i = 0; i < sampleSize; i++) {
      totalSampleSize += JSON.stringify(rules[i]).length * 2 // UTF-16 chars = ~2 bytes each
    }

    const avgRuleSize = totalSampleSize / sampleSize
    return Math.ceil(avgRuleSize * rules.length)
  }

  /**
   * Determine the optimal chunk size based on rule set size and available memory.
   */
  public getOptimalChunkSize(totalItems: number, estimatedItemSize: number = 500): number {
    // Target ~1MB per chunk
    const TARGET_CHUNK_BYTES = 1024 * 1024
    const itemsPerChunk = Math.max(10, Math.floor(TARGET_CHUNK_BYTES / estimatedItemSize))

    // Cap at 100 items per chunk
    const cappedChunkSize = Math.min(itemsPerChunk, 100)

    // Don't chunk if total is small enough to fit in one chunk
    if (totalItems <= cappedChunkSize) return totalItems

    return cappedChunkSize
  }

  // ── Statistics & Utilities ──────────────────────────────────────────

  /**
   * Get optimizer statistics for monitoring.
   */
  public getStats(): OptimizerStats {
    return { ...this.stats }
  }

  /**
   * Reset all statistics.
   */
  public resetStats(): void {
    this.stats = {
      diffOperations: 0,
      diffTotalDuration: 0,
      earlyExits: 0,
      deduplicatedRequests: 0,
      pooledConnections: 0,
      chunkedOperations: 0,
    }
  }

  /**
   * Clear internal caches (hash cache, in-flight requests).
   */
  public clearCaches(): void {
    this.hashCache.clear()
    this.inFlightRequests.clear()
  }

  /**
   * Get the number of active connections.
   */
  public getActiveConnections(): number {
    return this.activeConnections
  }

  /**
   * Get the number of pending connection requests.
   */
  public getPendingConnections(): number {
    return this.connectionQueue.length
  }

  /**
   * Get the number of in-flight deduplicated requests.
   */
  public getInFlightCount(): number {
    return this.inFlightRequests.size
  }

  // ── Private Helpers ─────────────────────────────────────────────────

  /**
   * Create a canonical string representation of a rule for hashing.
   * Keys are sorted to ensure deterministic output.
   */
  private canonicalizeRule(rule: UnifiedRule): string {
    const canonical: Record<string, unknown> = {
      action: rule.action,
      conditions: rule.conditions
        .map((c) => ({
          field: c.field,
          key: c.key,
          negated: c.negated,
          operator: c.operator,
          value: c.value,
        }))
        .sort((a, b) => `${a.field}:${a.operator}`.localeCompare(`${b.field}:${b.operator}`)),
      enabled: rule.enabled,
      name: rule.name,
    }

    if (rule.conditionLogic) canonical.conditionLogic = rule.conditionLogic
    if (rule.description) canonical.description = rule.description
    if (rule.priority !== undefined) canonical.priority = rule.priority

    return JSON.stringify(canonical)
  }

  /**
   * Simple string hash function (djb2 variant).
   * Fast and sufficient for equality comparison (not cryptographic).
   */
  private simpleHash(str: string): string {
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
    }
    return hash.toString(36)
  }
}
