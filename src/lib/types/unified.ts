/**
 * Unified (provider-agnostic) types
 * These types provide a common interface that works across all providers
 */

import type { ActionType, Operator, FieldType, ConfigMetadata, ProvidersConfig } from './common'
import type { ProviderType } from '../providers/IFirewallProvider'

/**
 * Unified rule condition
 * Provider-agnostic representation of a firewall rule condition
 */
export interface UnifiedCondition {
  field: FieldType | string
  operator: Operator
  // Optional: `exists`/`not_exists` operators carry no value by design (#85, #213).
  value?: string | number | string[] | number[]
  negated?: boolean
  key?: string // For header, query, cookie conditions
  /**
   * Index of the AND-group this condition belongs to, for providers with a
   * two-level condition model (AND within a group, OR across groups) — e.g.
   * Vercel's `conditionGroup[]`. Conditions sharing a `group` index are
   * AND'd together; distinct `group` values are OR'd against each other.
   * Omitted (or all conditions sharing the same/no value) means a single
   * implicit group — the flat, single-level model most providers use.
   */
  group?: number
}

/**
 * Unified rule action
 * Provider-agnostic representation of a firewall rule action
 */
export interface UnifiedAction {
  type: ActionType
  rateLimit?: {
    requests: number
    window: string
    characteristics?: string[]
    mitigationTimeout?: number // How long to block after rate limit exceeded (seconds)
    countingExpression?: string // Custom expression for counting requests
  }
  redirect?: {
    location: string
    statusCode?: number
    permanent?: boolean
    preserveQueryString?: boolean
  }
  /**
   * Custom response body returned when the rule matches.
   *
   * Only meaningful on a **deny/block** action, and only on providers that
   * support it — currently Cloudflare, which requires all three fields
   * together. `content` is therefore the trigger: without a body there's no
   * custom response to send, and `statusCode`/`contentType` fall back to
   * Cloudflare's defaults (403, `text/plain`) when omitted.
   *
   * Translating a rule that carries this to Vercel emits an
   * unsupported-feature warning — Vercel's mitigate action has no
   * equivalent, so the custom response is dropped rather than silently
   * pretended-at.
   */
  response?: {
    statusCode?: number
    content?: string
    contentType?: string
  }
  duration?: string // For temporary blocks/challenges
}

/**
 * Unified firewall rule
 * Provider-agnostic representation of a firewall rule
 */
export interface UnifiedRule {
  id?: string
  name: string
  description?: string
  enabled: boolean
  conditions: UnifiedCondition[]
  conditionLogic?: 'AND' | 'OR' // How to combine conditions (default: AND)
  action: UnifiedAction
  /**
   * Rule evaluation order. **Lower numbers are evaluated first**, matching
   * the convention of every provider that exposes an explicit numeric
   * priority. Rules without a priority keep their config-file order and are
   * evaluated *after* all prioritised rules, so adding `priority` to one
   * rule promotes it rather than demoting it. Equal priorities keep their
   * config-file order.
   *
   * Fully honoured on Cloudflare (the ruleset write is an ordered replace).
   * Best-effort on Vercel, which creates rules individually and cannot
   * reposition one that already exists — `syncRules` warns when that
   * applies. See `sortRulesByPriority`.
   *
   * Note this field only exists on the unified config format. The legacy
   * Vercel-only format (`FirewallConfig`/`CustomRule`, `additionalProperties:
   * false`) has no `priority`, so a legacy-shaped config cannot declare one —
   * deliberately, since ordering is best-effort on Vercel regardless and the
   * legacy schema isn't the place to add new capability surface.
   */
  priority?: number
  categories?: string[] // Tags for organization
}

/**
 * Unified IP blocking rule
 * Provider-agnostic representation of IP blocking
 */
export interface UnifiedIPRule {
  id?: string
  ip: string // IP address or CIDR range
  hostname?: string
  notes?: string
  action: 'deny' | 'allow'
}

/**
 * A per-rule override within a managed/vendor rule group — e.g. "enable the
 * vendor ruleset but downgrade this one noisy rule to log-only."
 */
export interface UnifiedManagedRuleGroupOverride {
  ruleId: string
  action?: ActionType
  enabled?: boolean
}

/**
 * Unified managed rule group
 * Provider-agnostic representation of a vendor-managed/preconfigured
 * ruleset (Cloudflare Managed Ruleset, AWS Managed Rules, GCP preconfigured
 * WAF, OWASP CRS, …) deployed as a whole, with optional per-rule overrides.
 *
 * A genuinely different kind of thing from `UnifiedRule` — no conditions,
 * and its identity is a vendor ruleset id rather than a user-authored
 * expression, so it isn't forced into `UnifiedRule[]`. See #183.
 */
export interface UnifiedManagedRuleGroup {
  /**
   * Provider-assigned identity for diff/sync matching — mirrors
   * `UnifiedRule.id`. Omitted for a new declaration not yet synced.
   */
  id?: string
  /** The vendor's managed-ruleset identifier being deployed (e.g. Cloudflare Managed Ruleset's well-known id). Opaque to doorman. */
  ruleset: string
  /** Optional human label. */
  name?: string
  /** Whether this managed-ruleset deployment is active. */
  enabled: boolean
  /** Ruleset-wide action override — e.g. downgrade every rule in the group to `log`. */
  action?: ActionType
  /** Per-rule overrides within the ruleset. */
  overrides?: UnifiedManagedRuleGroupOverride[]
}

/**
 * Unified firewall configuration
 * Provider-agnostic configuration format supporting all providers
 */
export interface UnifiedConfig {
  $schema?: string
  version?: string // Config version (e.g., "2.0")
  provider?: ProviderType // Active provider
  providers?: ProvidersConfig // Provider-specific settings
  rules: UnifiedRule[]
  ips?: UnifiedIPRule[]
  managedRules?: UnifiedManagedRuleGroup[]
  metadata?: ConfigMetadata
}

/**
 * Type guards for unified types
 */

export function isUnifiedConfig(obj: unknown): obj is UnifiedConfig {
  return (
    !!obj &&
    typeof obj === 'object' &&
    'rules' in (obj as Record<string, unknown>) &&
    Array.isArray((obj as Record<string, unknown>).rules)
  )
}

/**
 * Distinguishes a multi-provider (Unified) config from a legacy Vercel-only config.
 * Both shapes have a top-level `rules` array, so `isUnifiedConfig` alone can't tell
 * them apart — this checks for the `provider`/`providers` fields that only appear on
 * multi-provider configs (matching the signal `ProviderDetector` already relies on).
 */
export function hasProviderMetadata(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false
  const rec = obj as Record<string, unknown>
  return typeof rec.provider === 'string' || (typeof rec.providers === 'object' && rec.providers !== null)
}

export function isUnifiedRule(obj: unknown): obj is UnifiedRule {
  const rec = obj as Record<string, unknown>
  return !!obj && typeof obj === 'object' && 'name' in rec && 'enabled' in rec && 'conditions' in rec && 'action' in rec
}

export function isUnifiedIPRule(obj: unknown): obj is UnifiedIPRule {
  const rec = obj as Record<string, unknown>
  return !!obj && typeof obj === 'object' && 'ip' in rec && 'action' in rec
}

/**
 * Helper to create a unified condition
 */
export function createUnifiedCondition(
  field: FieldType | string,
  operator: Operator,
  value: string | number | string[] | number[],
  options?: {
    negated?: boolean
    key?: string
  },
): UnifiedCondition {
  return {
    field,
    operator,
    value,
    negated: options?.negated,
    key: options?.key,
  }
}

/**
 * Helper to create a unified action
 */
export function createUnifiedAction(
  type: ActionType,
  options?: {
    rateLimit?: UnifiedAction['rateLimit']
    redirect?: UnifiedAction['redirect']
    response?: UnifiedAction['response']
    duration?: string
  },
): UnifiedAction {
  return {
    type,
    ...options,
  }
}

/**
 * Helper to create a unified rule
 */
export function createUnifiedRule(
  name: string,
  conditions: UnifiedCondition[],
  action: UnifiedAction,
  options?: {
    id?: string
    description?: string
    enabled?: boolean
    conditionLogic?: 'AND' | 'OR'
    priority?: number
    categories?: string[]
  },
): UnifiedRule {
  return {
    name,
    conditions,
    action,
    enabled: options?.enabled ?? true,
    id: options?.id,
    description: options?.description,
    conditionLogic: options?.conditionLogic,
    priority: options?.priority,
    categories: options?.categories,
  }
}
