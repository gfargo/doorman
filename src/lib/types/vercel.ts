/**
 * Vercel Firewall specific types
 * These types map directly to Vercel's Firewall API
 */

import type { ActionType } from './common'

/**
 * Vercel rule operators
 */
export type VercelRuleOperator =
  | 'eq' // 'Equals' (has negative 'neg' -> 'Does not equal')
  | 'pre' // 'Starts with' Prefix (has negative 'neg' -> 'Does not start with')
  | 'suf' // 'Ends with' Suffix (has negative 'neg' -> 'Does not end with')
  | 'inc' // 'Is any of' Includes (has negative 'neg' -> 'Is not any of')
  | 'sub' // 'Contains' substring (has negative 'neg' -> 'Does not contain')
  | 're' // 'Matches expression' Regular expression (has negative 'neg' -> 'Does not match expression')
  | 'ex' // 'Exists'
  | 'nex' // 'Does not exist' Not exists

/**
 * Vercel condition types
 */
export type VercelRuleType =
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
 * Vercel rule condition
 */
export interface VercelRuleCondition {
  op: VercelRuleOperator
  neg?: boolean
  type: VercelRuleType
  key?: string
  value?: string | number | string[] | number[]
}

/**
 * Vercel condition group (AND conditions)
 */
export interface VercelConditionGroup {
  conditions: VercelRuleCondition[]
}

/**
 * Vercel rate limit configuration
 */
export interface VercelRateLimit {
  requests: number
  window: string // e.g., "60s", "1h", "1d"
  characteristics?: string[] // Cloudflare-specific: fields to rate limit by
  mitigationTimeout?: number // Cloudflare-specific: block duration in seconds
  countingExpression?: string // Cloudflare-specific: custom counting expression
}

/**
 * Vercel redirect configuration
 */
export interface VercelRedirect {
  location: string
  permanent?: boolean
}

/**
 * Vercel mitigation action
 */
export interface VercelMitigationAction {
  action: ActionType
  rateLimit?: VercelRateLimit | null
  redirect?: VercelRedirect | null
  actionDuration?: string | null // e.g., "1h", "1d", "permanent"
}

/**
 * Vercel rule action
 */
export interface VercelRuleAction {
  mitigate: VercelMitigationAction
}

/**
 * Vercel custom rule
 */
export interface VercelCustomRule {
  id?: string
  name: string
  description?: string
  conditionGroup: VercelConditionGroup[]
  action: VercelRuleAction
  active: boolean
}

/**
 * Vercel IP blocking rule
 */
export interface VercelIPBlockingRule {
  id?: string
  ip: string
  hostname?: string // Informational only — not required by Vercel's API (#219)
  notes?: string
  action: 'deny' // Currently only 'deny' is supported for IP blocking
}

/**
 * Vercel project configuration
 */
export interface VercelProjectConfig {
  projectId?: string
  teamId?: string
}

/**
 * Vercel firewall configuration
 */
export interface VercelFirewallConfig extends VercelProjectConfig {
  $schema?: string
  version?: number
  firewallEnabled?: boolean
  rules: VercelCustomRule[]
  ips?: VercelIPBlockingRule[]
  updatedAt?: string
}

/**
 * Vercel API response for firewall config
 */
export interface VercelFirewallAPIResponse {
  firewallEnabled: boolean
  crs: {
    sd: unknown[]
    fw: {
      r: VercelCustomRule[]
      ips: VercelIPBlockingRule[]
    }
  }
  version: number
  updatedAt: number
}

// Re-export legacy type names for backward compatibility
export type RuleOperator = VercelRuleOperator
export type RuleType = VercelRuleType
export type RuleCondition = VercelRuleCondition
export type ConditionGroup = VercelConditionGroup
export type RateLimit = VercelRateLimit
export type Redirect = VercelRedirect
export type MitigationAction = VercelMitigationAction
export type RuleAction = VercelRuleAction
export type CustomRule = VercelCustomRule
export type IPBlockingRule = VercelIPBlockingRule
export type ProjectConfig = VercelProjectConfig
export type FirewallConfig = VercelFirewallConfig
