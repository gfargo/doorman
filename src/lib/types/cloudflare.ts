/**
 * Cloudflare WAF specific types
 * These types map to Cloudflare's Ruleset Engine API
 */

/**
 * Cloudflare ruleset kind
 */
export type CloudflareRulesetKind = 'root' | 'zone' | 'custom' | 'managed'

/**
 * Cloudflare ruleset phase
 */
export type CloudflareRulesetPhase =
  | 'http_request_firewall_custom'
  | 'http_request_firewall_managed'
  | 'http_ratelimit'
  | 'http_request_transform'
  | 'http_response_headers_transform'

/**
 * Cloudflare rule action types
 */
export type CloudflareAction =
  | 'block'
  | 'challenge'
  | 'managed_challenge'
  | 'js_challenge'
  | 'log'
  | 'skip'
  | 'allow'
  | 'rewrite'
  | 'redirect'
  | 'execute' // Deploys a managed/vendor ruleset (#183) — see CloudflareExecuteActionParameters.

/**
 * Cloudflare action parameters for block actions
 */
export interface CloudflareBlockActionParameters {
  response?: {
    status_code: number
    content: string
    content_type: string
  }
}

/**
 * Cloudflare action parameters for redirect actions
 */
export interface CloudflareRedirectActionParameters {
  from_value: {
    status_code: number
    target_url: {
      value: string
    }
    preserve_query_string?: boolean
  }
}

/**
 * Cloudflare rate limit configuration
 */
export interface CloudflareRateLimit {
  characteristics: string[] // e.g., ["ip.src", "cf.colo.id"]
  period: number // seconds
  requests_per_period: number
  mitigation_timeout?: number // seconds
  counting_expression?: string
}

/**
 * Cloudflare skip action parameters
 */
export interface CloudflareSkipActionParameters {
  ruleset?: string
  phases?: string[]
  products?: string[]
  rules?: { [rulesetId: string]: string[] }
}

/**
 * A single rule's override within an executed managed ruleset, referenced
 * by that rule's id within the vendor ruleset (not doorman's own id space).
 */
export interface CloudflareManagedRuleOverride {
  id: string
  action?: CloudflareAction
  enabled?: boolean
}

/**
 * A tag/category-level override within an executed managed ruleset — applies
 * to every rule in the ruleset carrying that tag (e.g. Cloudflare's
 * "wordpress" tag on its Managed Ruleset).
 */
export interface CloudflareManagedRuleCategoryOverride {
  category: string
  action?: CloudflareAction
  enabled?: boolean
}

/**
 * Cloudflare action parameters for the `execute` action — deploys a
 * vendor-managed ruleset, identified by `id`, with optional overrides at
 * the ruleset, category/tag, and individual-rule level. Confirmed against
 * https://developers.cloudflare.com/ruleset-engine/managed-rulesets/override-managed-ruleset/
 * (#183) — doorman only models ruleset-level and rule-level overrides today
 * (see UnifiedManagedRuleGroup); `categories` exists here because it's part
 * of the real API shape, but nothing currently populates it.
 */
export interface CloudflareExecuteActionParameters {
  id: string
  overrides?: {
    action?: CloudflareAction
    enabled?: boolean
    categories?: CloudflareManagedRuleCategoryOverride[]
    rules?: CloudflareManagedRuleOverride[]
  }
}

/**
 * Cloudflare action parameters union
 */
export type CloudflareActionParameters =
  | CloudflareBlockActionParameters
  | CloudflareRedirectActionParameters
  | CloudflareSkipActionParameters
  | CloudflareExecuteActionParameters

/**
 * Cloudflare rule
 */
export interface CloudflareRule {
  id: string
  version?: string
  action: CloudflareAction
  expression: string // Wirefilter expression
  description?: string
  enabled?: boolean
  categories?: string[]
  last_updated?: string
  ref?: string // Reference to managed rule
  action_parameters?: CloudflareActionParameters
  ratelimit?: CloudflareRateLimit
}

/**
 * Cloudflare ruleset
 */
export interface CloudflareRuleset {
  id: string
  name: string
  description?: string
  kind: CloudflareRulesetKind
  version: string
  phase: CloudflareRulesetPhase
  rules: CloudflareRule[]
  last_updated?: string
}

/**
 * Cloudflare zone configuration
 */
export interface CloudflareZoneConfig {
  zoneId: string
  accountId?: string
}

/**
 * Cloudflare firewall configuration
 */
export interface CloudflareFirewallConfig extends CloudflareZoneConfig {
  $schema?: string
  version?: string
  rulesets?: CloudflareRuleset[]
  rules?: CloudflareRule[] // Simplified format - single custom ruleset
  updatedAt?: string
}

/**
 * Cloudflare API response wrapper
 */
export interface CloudflareAPIResponse<T> {
  success: boolean
  errors: CloudflareAPIError[]
  messages: CloudflareAPIMessage[]
  result: T
  result_info?: CloudflareResultInfo
}

/**
 * Cloudflare API error
 */
export interface CloudflareAPIError {
  code: number
  message: string
  error_chain?: CloudflareAPIError[]
}

/**
 * Cloudflare API message
 */
export interface CloudflareAPIMessage {
  code: number
  message: string
}

/**
 * Cloudflare API result info (pagination)
 */
export interface CloudflareResultInfo {
  page: number
  per_page: number
  count: number
  total_count: number
  total_pages: number
}

/**
 * Create ruleset request
 */
export interface CloudflareCreateRulesetRequest {
  name: string
  kind: CloudflareRulesetKind
  phase: CloudflareRulesetPhase
  description?: string
  rules?: Omit<CloudflareRule, 'id' | 'version' | 'last_updated'>[]
}

/**
 * Update ruleset request
 */
export interface CloudflareUpdateRulesetRequest {
  name?: string
  description?: string
  rules?: CloudflareRule[]
}

/**
 * Create rule request
 */
export interface CloudflareCreateRuleRequest extends Omit<CloudflareRule, 'id' | 'version' | 'last_updated'> {}

/**
 * Update rule request
 */
export interface CloudflareUpdateRuleRequest extends Partial<CloudflareRule> {}

/**
 * Wirefilter expression field types
 */
export type CloudflareFieldType =
  | 'http.request.uri.path'
  | 'http.request.uri.query'
  | 'http.request.method'
  | 'http.request.headers'
  | 'http.request.body.raw'
  | 'http.host'
  | 'http.user_agent'
  | 'http.referer'
  | 'http.cookie'
  | 'ip.src'
  | 'ip.geoip.country'
  | 'ip.geoip.continent'
  | 'ip.geoip.subdivision_1'
  | 'ip.geoip.city'
  | 'ip.geoip.asnum'
  | 'cf.bot_management.score'
  | 'cf.threat_score'
  | 'cf.tls_version'
  | 'cf.tls_cipher'

/**
 * Cloudflare List types
 * Lists are used for bulk IP management in Cloudflare WAF
 */

/**
 * Cloudflare List kind
 */
export type CloudflareListKind = 'ip'

/**
 * Cloudflare List item (IP address)
 */
export interface CloudflareListItem {
  id?: string
  ip?: string // IPv4 or IPv6 address
  comment?: string
  created_on?: string
  modified_on?: string
}

/**
 * Cloudflare List
 */
export interface CloudflareList {
  id: string
  name: string
  description?: string
  kind: CloudflareListKind
  num_items: number
  num_referencing_filters: number
  created_on: string
  modified_on: string
}

/**
 * Create Cloudflare List request
 */
export interface CloudflareCreateListRequest {
  name: string
  description?: string
  kind: CloudflareListKind
}

/**
 * Update Cloudflare List request
 */
export interface CloudflareUpdateListRequest {
  description?: string
}

/**
 * Add items to List request
 */
export interface CloudflareAddListItemsRequest {
  items: Array<{
    ip: string
    comment?: string
  }>
}

/**
 * Remove items from List request
 */
export interface CloudflareRemoveListItemsRequest {
  items: Array<{
    id: string
  }>
}

/**
 * List items response
 */
export interface CloudflareListItemsResponse {
  result: CloudflareListItem[]
  success: boolean
  errors: Array<{ code: number; message: string }>
  messages: Array<{ code: number; message: string }>
  result_info?: {
    count: number
    page: number
    per_page: number
    total_count: number
    total_pages: number
  }
}
