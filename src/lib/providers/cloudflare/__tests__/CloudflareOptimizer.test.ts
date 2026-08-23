import { describe, it, expect, beforeEach } from '@jest/globals'
import { CloudflareOptimizer } from '../CloudflareOptimizer'
import type { UnifiedRule, UnifiedIPRule } from '../../../types/unified'

/**
 * Helper to generate test rules
 */
function makeRule(id: string, overrides: Partial<UnifiedRule> = {}): UnifiedRule {
  return {
    id,
    name: `Rule ${id}`,
    enabled: true,
    conditions: [{ field: 'path', operator: 'eq', value: `/path-${id}` }],
    action: { type: 'block' },
    ...overrides,
  }
}

function makeIPRule(ip: string, action: 'deny' | 'allow' = 'deny'): UnifiedIPRule {
  return { ip, action, notes: `Block ${ip}` }
}

function makeRules(count: number): UnifiedRule[] {
  return Array.from({ length: count }, (_, i) => makeRule(`rule-${i}`))
}

describe('CloudflareOptimizer', () => {
  let optimizer: CloudflareOptimizer

  beforeEach(() => {
    optimizer = new CloudflareOptimizer()
  })

  // ── Rule Diffing ────────────────────────────────────────────────────

  describe('diffRules', () => {
    it('should return empty diff when both arrays are empty', () => {
      const result = optimizer.diffRules([], [])
      expect(result.toAdd).toHaveLength(0)
      expect(result.toUpdate).toHaveLength(0)
      expect(result.toDelete).toHaveLength(0)
      expect(result.unchanged).toBe(0)
    })

    it('should detect all rules as additions when remote is empty', () => {
      const local = [makeRule('a'), makeRule('b')]
      const result = optimizer.diffRules(local, [])
      expect(result.toAdd).toHaveLength(2)
      expect(result.toDelete).toHaveLength(0)
      expect(result.toUpdate).toHaveLength(0)
    })

    it('should detect all rules as deletions when local is empty', () => {
      const remote = [makeRule('a'), makeRule('b')]
      const result = optimizer.diffRules([], remote)
      expect(result.toDelete).toHaveLength(2)
      expect(result.toAdd).toHaveLength(0)
    })

    it('should detect unchanged rules', () => {
      const rules = [makeRule('a'), makeRule('b')]
      const result = optimizer.diffRules(rules, rules)
      expect(result.unchanged).toBe(2)
      expect(result.toAdd).toHaveLength(0)
      expect(result.toUpdate).toHaveLength(0)
      expect(result.toDelete).toHaveLength(0)
    })

    it('should detect updated rules by hash difference', () => {
      const local = [makeRule('a', { description: 'updated' })]
      const remote = [makeRule('a', { description: 'original' })]
      const result = optimizer.diffRules(local, remote)
      expect(result.toUpdate).toHaveLength(1)
      expect(result.toUpdate[0]!.id).toBe('a')
    })

    it('should detect mixed add/update/delete', () => {
      const local = [
        makeRule('a'),
        makeRule('b', { description: 'changed' }),
        makeRule('d'), // new
      ]
      const remote = [
        makeRule('a'),
        makeRule('b'),
        makeRule('c'), // to be deleted
      ]
      const result = optimizer.diffRules(local, remote)
      expect(result.toAdd).toHaveLength(1)
      expect(result.toAdd[0]!.id).toBe('d')
      expect(result.toUpdate).toHaveLength(1)
      expect(result.toUpdate[0]!.id).toBe('b')
      expect(result.toDelete).toHaveLength(1)
      expect(result.toDelete[0]!.id).toBe('c')
      expect(result.unchanged).toBe(1)
    })

    it('should use early exit for same reference', () => {
      const rules = makeRules(10)
      optimizer.diffRules(rules, rules)
      const stats = optimizer.getStats()
      expect(stats.earlyExits).toBeGreaterThan(0)
    })

    it('should handle large rule sets efficiently', () => {
      const local = makeRules(500)
      const remote = makeRules(500)
      // Modify some rules
      local[100] = makeRule('rule-100', { description: 'modified' })
      local.push(makeRule('new-rule'))

      const start = performance.now()
      const result = optimizer.diffRules(local, remote)
      const duration = performance.now() - start

      expect(result.toAdd).toHaveLength(1)
      expect(result.toUpdate).toHaveLength(1)
      expect(result.unchanged).toBe(499)
      // Should complete in under 100ms for 500 rules
      expect(duration).toBeLessThan(100)
    })
  })

  // ── IP Rule Diffing ─────────────────────────────────────────────────

  describe('diffIPRules', () => {
    it('should return empty diff when both arrays are empty', () => {
      const result = optimizer.diffIPRules([], [])
      expect(result.toAdd).toHaveLength(0)
      expect(result.toDelete).toHaveLength(0)
    })

    it('should detect new IPs', () => {
      const local = [makeIPRule('1.2.3.4'), makeIPRule('5.6.7.8')]
      const result = optimizer.diffIPRules(local, [])
      expect(result.toAdd).toHaveLength(2)
    })

    it('should detect removed IPs', () => {
      const remote = [makeIPRule('1.2.3.4')]
      const result = optimizer.diffIPRules([], remote)
      expect(result.toDelete).toHaveLength(1)
    })

    it('should detect action changes', () => {
      const local = [makeIPRule('1.2.3.4', 'allow')]
      const remote = [makeIPRule('1.2.3.4', 'deny')]
      const result = optimizer.diffIPRules(local, remote)
      expect(result.toUpdate).toHaveLength(1)
    })

    it('should detect unchanged IPs', () => {
      const rules = [makeIPRule('1.2.3.4'), makeIPRule('5.6.7.8')]
      const result = optimizer.diffIPRules(rules, rules)
      expect(result.unchanged).toBe(2)
    })
  })

  // ── Rule Hashing ────────────────────────────────────────────────────

  describe('computeRuleHash', () => {
    it('should produce consistent hashes for identical rules', () => {
      const rule = makeRule('a')
      const hash1 = optimizer.computeRuleHash(rule)
      const hash2 = optimizer.computeRuleHash(rule)
      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different rules', () => {
      const rule1 = makeRule('a')
      const rule2 = makeRule('a', { description: 'different' })
      // Clear cache to force recomputation
      optimizer.clearCaches()
      const hash1 = optimizer.computeRuleHash(rule1)
      optimizer.clearCaches()
      const hash2 = optimizer.computeRuleHash(rule2)
      expect(hash1).not.toBe(hash2)
    })

    it('should cache hashes for repeated lookups', () => {
      const rule = makeRule('cached-rule')
      const hash1 = optimizer.computeRuleHash(rule)
      const hash2 = optimizer.computeRuleHash(rule)
      expect(hash1).toBe(hash2)
    })

    it('should produce same hash regardless of condition order', () => {
      const rule1 = makeRule('a', {
        conditions: [
          { field: 'path', operator: 'eq', value: '/a' },
          { field: 'ip', operator: 'eq', value: '1.2.3.4' },
        ],
      })
      const rule2 = makeRule('a', {
        conditions: [
          { field: 'ip', operator: 'eq', value: '1.2.3.4' },
          { field: 'path', operator: 'eq', value: '/a' },
        ],
      })
      optimizer.clearCaches()
      const hash1 = optimizer.computeRuleHash(rule1)
      optimizer.clearCaches()
      const hash2 = optimizer.computeRuleHash(rule2)
      expect(hash1).toBe(hash2)
    })
  })

  // ── Connection Pooling ──────────────────────────────────────────────

  describe('connection pooling', () => {
    it('should allow concurrent operations up to maxConnections', async () => {
      const poolOptimizer = new CloudflareOptimizer({ maxConnections: 3 })
      let concurrent = 0
      let maxConcurrent = 0

      const operations = Array.from({ length: 6 }, () => async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 50))
        concurrent--
        return maxConcurrent
      })

      await poolOptimizer.executePooled(operations)
      expect(maxConcurrent).toBeLessThanOrEqual(3)
    })

    it('should track active connections', async () => {
      expect(optimizer.getActiveConnections()).toBe(0)

      await optimizer.withConnection(async () => {
        expect(optimizer.getActiveConnections()).toBe(1)
      })

      expect(optimizer.getActiveConnections()).toBe(0)
    })

    it('should queue connections when pool is full', async () => {
      const smallPool = new CloudflareOptimizer({ maxConnections: 1 })
      const order: number[] = []

      const op1 = smallPool.withConnection(async () => {
        order.push(1)
        await new Promise((r) => setTimeout(r, 50))
      })

      const op2 = smallPool.withConnection(async () => {
        order.push(2)
      })

      await Promise.all([op1, op2])
      expect(order).toEqual([1, 2])
    })

    it('should return empty results for empty operations array', async () => {
      const results = await optimizer.executePooled([])
      expect(results).toEqual([])
    })
  })

  // ── Request Deduplication ───────────────────────────────────────────

  describe('request deduplication', () => {
    it('should deduplicate identical concurrent requests', async () => {
      let callCount = 0
      const operation = async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 50))
        return 'result'
      }

      const [r1, r2] = await Promise.all([
        optimizer.deduplicateRequest('test-key', operation),
        optimizer.deduplicateRequest('test-key', operation),
      ])

      expect(r1).toBe('result')
      expect(r2).toBe('result')
      expect(callCount).toBe(1)
      expect(optimizer.getStats().deduplicatedRequests).toBe(1)
    })

    it('should not deduplicate requests with different keys', async () => {
      let callCount = 0
      const operation = async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 10))
        return callCount
      }

      await Promise.all([
        optimizer.deduplicateRequest('key-1', operation),
        optimizer.deduplicateRequest('key-2', operation),
      ])

      expect(callCount).toBe(2)
    })

    it('should allow new requests after previous ones complete', async () => {
      let callCount = 0
      const operation = async () => {
        callCount++
        return callCount
      }

      const r1 = await optimizer.deduplicateRequest('key', operation)
      const r2 = await optimizer.deduplicateRequest('key', operation)

      expect(r1).toBe(1)
      expect(r2).toBe(2)
      expect(callCount).toBe(2)
    })

    it('should generate consistent request keys', () => {
      const key1 = CloudflareOptimizer.requestKey('GET', '/api/rulesets')
      const key2 = CloudflareOptimizer.requestKey('GET', '/api/rulesets')
      expect(key1).toBe(key2)

      const key3 = CloudflareOptimizer.requestKey('POST', '/api/rulesets', '{"name":"test"}')
      expect(key3).not.toBe(key1)
    })

    it('should clean up in-flight requests after completion', async () => {
      await optimizer.deduplicateRequest('cleanup-test', async () => 'done')
      expect(optimizer.getInFlightCount()).toBe(0)
    })
  })

  // ── Memory-Efficient Processing ─────────────────────────────────────

  describe('processInChunks', () => {
    it('should process items in chunks', async () => {
      const items = Array.from({ length: 25 }, (_, i) => i)
      const chunkSizes: number[] = []

      const results = await optimizer.processInChunks(items, 10, async (chunk) => {
        chunkSizes.push(chunk.length)
        return chunk.map((n) => n * 2)
      })

      expect(results).toHaveLength(25)
      expect(results[0]).toBe(0)
      expect(results[24]).toBe(48)
      expect(chunkSizes).toEqual([10, 10, 5])
    })

    it('should handle empty arrays', async () => {
      const results = await optimizer.processInChunks([], 10, async (chunk) => chunk)
      expect(results).toEqual([])
    })

    it('should handle arrays smaller than chunk size', async () => {
      const items = [1, 2, 3]
      const results = await optimizer.processInChunks(items, 100, async (chunk) => chunk)
      expect(results).toEqual([1, 2, 3])
    })

    it('should track chunked operations in stats', async () => {
      await optimizer.processInChunks([1, 2, 3], 2, async (chunk) => chunk)
      expect(optimizer.getStats().chunkedOperations).toBe(1)
    })
  })

  describe('estimateMemoryUsage', () => {
    it('should return 0 for empty arrays', () => {
      expect(optimizer.estimateMemoryUsage([])).toBe(0)
    })

    it('should estimate memory for rule arrays', () => {
      const rules = makeRules(100)
      const estimate = optimizer.estimateMemoryUsage(rules)
      expect(estimate).toBeGreaterThan(0)
      // Each rule is roughly 100-300 bytes, so 100 rules should be 10-30KB
      expect(estimate).toBeLessThan(100000)
    })
  })

  describe('getOptimalChunkSize', () => {
    it('should return total items when count is small', () => {
      expect(optimizer.getOptimalChunkSize(5)).toBe(5)
    })

    it('should cap chunk size at 100', () => {
      expect(optimizer.getOptimalChunkSize(10000, 10)).toBeLessThanOrEqual(100)
    })

    it('should return at least 10', () => {
      expect(optimizer.getOptimalChunkSize(10000, 1000000)).toBeGreaterThanOrEqual(10)
    })
  })

  // ── Statistics ──────────────────────────────────────────────────────

  describe('statistics', () => {
    it('should track diff operations', () => {
      optimizer.diffRules([makeRule('a')], [makeRule('b')])
      const stats = optimizer.getStats()
      expect(stats.diffOperations).toBe(1)
      expect(stats.diffTotalDuration).toBeGreaterThan(0)
    })

    it('should reset stats', () => {
      optimizer.diffRules([], [])
      optimizer.resetStats()
      const stats = optimizer.getStats()
      expect(stats.diffOperations).toBe(0)
      expect(stats.earlyExits).toBe(0)
    })

    it('should clear caches', () => {
      optimizer.computeRuleHash(makeRule('a'))
      optimizer.clearCaches()
      // After clearing, the hash should be recomputed (no error)
      const hash = optimizer.computeRuleHash(makeRule('a'))
      expect(hash).toBeTruthy()
    })
  })
})
