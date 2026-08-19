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
  value: string | number | string[] | number[]
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
  priority?: number // Rule execution order
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
