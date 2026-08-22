/**
 * Core Types
 */
export type ActionType = 'log' | 'deny' | 'challenge' | 'bypass' | 'rate_limit' | 'redirect'

export type RuleOperator =
  | 'eq' // 'Equals' (has negative 'neg' -> 'Does not equal')
  | 'pre' // 'Starts with' Prefix (has negative 'neg' -> 'Does not start with')
  | 'suf' // 'Ends with' Suffix (has negative 'neg' -> 'Does not end with')
  | 'inc' // 'Is any of' Includes (has negative 'neg' -> 'Is not any of')
  | 'sub' // 'Contains' substring (has negative 'neg' -> 'Does not contain')
  | 're' // 'Matches expression' Regular expression (has negative 'neg' -> 'Does not match expression')
  | 'ex' // 'Exists'
  | 'nex' // 'Does not exist' Not exists

export type RuleType =
  | 'host'
  | 'path'
  | 'method'
  | 'header'
  | 'query'
  | 'cookie'
  | 'target_path'
  | 'ip_address'
  | 'region'
  | 'protocol'
  | 'scheme'
  | 'environment'
  | 'user_agent'
  | 'geo_continent'
  | 'geo_country'
  | 'geo_country_region'
  | 'geo_city'
  | 'geo_as_number'
  | 'ja4_digest'
  | 'ja3_digest'
  | 'rate_limit_api_id'

/**
 * Rule Condition Types
 */
export interface RuleCondition {
  op: RuleOperator
  neg?: boolean
  type: RuleType
  key?: string
  value?: string | number | string[] | number[]
}

export interface ConditionGroup {
  conditions: RuleCondition[]
}

/**
 * Action Types
 */
export interface RateLimit {
  requests: number
  window: string // e.g., "60s", "1h", "1d"
}

export interface Redirect {
  location: string
  permanent?: boolean
}

export interface MitigationAction {
  action: ActionType
  rateLimit?: RateLimit | null
  redirect?: Redirect | null
  actionDuration?: string | null // e.g., "1h", "1d", "permanent"
}

export interface RuleAction {
  mitigate: MitigationAction
}

/**
 * Rule Types
 */
export interface CustomRule {
  id?: string
  name: string
  description?: string
  conditionGroup: ConditionGroup[]
  action: RuleAction
  active: boolean
}

export interface IPBlockingRule {
  id?: string
  ip: string
  hostname?: string // Informational only — not required by Vercel's API (#219)
  notes?: string
  action: 'deny' // Currently only 'deny' is supported for IP blocking
}

/**
 * Configuration Types
 */
export interface ProjectConfig {
  projectId?: string
  teamId?: string
}

/**
 * The main configuration type for Doorman
 * @property $schema - The URI of the JSON Schema to validate against
 * @property version - Configuration version number
 * @property rules - List of firewall rules
 * @property ips - Optional list of IP blocking rules
 * @property updatedAt - Last update timestamp
 */
export interface FirewallConfig extends ProjectConfig {
  $schema?: string
  version?: number
  firewallEnabled?: boolean
  rules: CustomRule[]
  ips?: IPBlockingRule[]
  updatedAt?: string
}

// Re-export unified types for multi-provider support
export type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from './types/unified'
export { isUnifiedConfig, isUnifiedRule, isUnifiedIPRule, hasProviderMetadata } from './types/unified'
