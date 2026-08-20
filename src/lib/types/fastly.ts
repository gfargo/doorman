/**
 * Fastly Next-Gen WAF (formerly Signal Sciences) specific types.
 * These map directly to the `ngwaf/v1` surface of Fastly's REST API
 * (`https://api.fastly.com/ngwaf/v1/...`), confirmed against the `rules`,
 * `scope`, `workspaces`, and `lists` packages of Fastly's official Go SDK
 * (`go-fastly`) and the `fastly_ngwaf_workspace_rule` Terraform resource
 * schema — not the classic VCL service API, which is out of scope (see
 * issue #186).
 */

/**
 * Fastly condition operators. The literal strings below are confirmed
 * against `fastly_ngwaf_workspace_rule`'s Terraform schema (the enum is
 * documented exhaustively there) and Fastly's Go SDK round-trip tests.
 */
export type FastlyConditionOperator =
  | 'equals'
  | 'does_not_equal'
  | 'contains'
  | 'does_not_contain'
  | 'like'
  | 'not_like'
  | 'in_list'
  | 'not_in_list'
  | 'matches'
  | 'does_not_match'
  | 'greater_equal'
  | 'lesser_equal'

/**
 * Multival conditions (nested key/value matching, e.g. a specific header
 * name+value pair) only ever use existence-style operators at the multival
 * level — the nested `condition[]` entries use the full `FastlyConditionOperator`
 * set above.
 */
export type FastlyMultivalOperator = 'exists' | 'does_not_exist'

/** `any` = OR the members together, `all` = AND them. */
export type FastlyGroupOperator = 'any' | 'all'

/**
 * Single (non-grouped, non-multival) condition field names. Not
 * exhaustive — Fastly's condition-field vocabulary is large (see "Defining
 * rule conditions" in Fastly's docs) and unrecognised values pass through
 * as plain strings; these are the ones doorman's translator actively maps
 * to/from `UnifiedCondition.field`.
 */
export type FastlyConditionField = 'ip' | 'path' | 'domain' | 'method' | 'country' | 'scheme' | 'user_agent' | string

/** Fields a multival condition can target. */
export type FastlyMultivalField =
  | 'post_parameter'
  | 'query_parameter'
  | 'request_cookie'
  | 'request_header'
  | 'response_header'
  | 'signal'

export interface FastlySingleCondition {
  type: 'single'
  field: FastlyConditionField
  operator: FastlyConditionOperator
  value: string
}

/**
 * A nested condition inside a `multival` block, matching against the
 * multival's key (`name`) or value (`value`/`value_string` — headers use
 * `value_string`, everything else uses `value`; confirmed by Fastly's own
 * recorded integration test for `request_cookie` vs. its Terraform example
 * for `request_header`).
 */
export interface FastlyMultivalSubCondition {
  type: 'single'
  field: 'name' | 'value' | 'value_string' | string
  operator: FastlyConditionOperator
  value: string
}

export interface FastlyMultivalCondition {
  type: 'multival'
  field: FastlyMultivalField
  operator: FastlyMultivalOperator
  group_operator: FastlyGroupOperator
  conditions: FastlyMultivalSubCondition[]
}

/**
 * A group's own children are single/multival only — Fastly's API does not
 * allow a group nested inside another group. Confirmed by go-fastly's
 * `GroupConditionItem` doc comment ("can be either single or multival, but
 * not a nested group"), which is exactly the bounded, two-level shape
 * `UnifiedCondition.group` was designed to express (see #186's "no
 * recursive condition trees" assumption).
 */
export type FastlyGroupConditionItem = FastlySingleCondition | FastlyMultivalCondition

export interface FastlyGroupCondition {
  type: 'group'
  group_operator: FastlyGroupOperator
  conditions: FastlyGroupConditionItem[]
}

/** A rule's top-level `conditions[]` entries — single, group, or multival. */
export type FastlyConditionItem = FastlySingleCondition | FastlyGroupCondition | FastlyMultivalCondition

/**
 * Action types valid on a `request`-type rule. `redirect`/`deception` are
 * documented via their parameter fields (`redirect_url`, `deception_type`)
 * even though the Terraform schema's own "One of" list omits them — kept
 * here since the field docs explicitly reference `type = redirect` /
 * `type = deception`.
 */
export type FastlyRequestActionType =
  | 'allow'
  | 'block'
  | 'browser_challenge'
  | 'dynamic_challenge'
  | 'verify_token'
  | 'add_signal'
  | 'exclude_signal'
  | 'redirect'
  | 'deception'

/** Action types valid on a `rate_limit`-type rule — a distinct, smaller set. */
export type FastlyRateLimitActionType = 'log_request' | 'block_signal' | 'browser_challenge' | 'verify_token'

export interface FastlyAction {
  type: FastlyRequestActionType | FastlyRateLimitActionType
  allow_interactive?: boolean
  deception_type?: string
  redirect_url?: string
  response_code?: number
  signal?: string
}

export type FastlyClientIdentifierType =
  | 'ip'
  | 'post_parameter'
  | 'request_cookie'
  | 'request_header'
  | 'signal_payload'

export interface FastlyClientIdentifier {
  type: FastlyClientIdentifierType
  key?: string
  name?: string
}

export interface FastlyRateLimit {
  client_identifiers: FastlyClientIdentifier[]
  duration: number
  /** Seconds — Fastly only accepts 60, 600, or 3600. */
  interval: number
  signal: string
  threshold: number
}

/**
 * A rule's scope — `workspace` (single site, the only shape doorman
 * currently targets — see #185, multi-resource targeting, as the tracked
 * follow-up for `account`-scoped rules spanning multiple workspaces) or
 * `account` (spans workspaces via `applies_to`, out of scope for now).
 */
export interface FastlyScope {
  type: 'workspace' | 'account'
  applies_to: string[]
}

export type FastlyRuleType = 'request' | 'signal' | 'rate_limit' | 'templated_signal'

/**
 * A Fastly Next-Gen WAF rule, as returned by `GET/POST/PATCH
 * /ngwaf/v1/workspaces/{workspaceId}/rules`.
 *
 * doorman's translator only round-trips `type: 'request'` and `type:
 * 'rate_limit'` rules — `signal`/`templated_signal` rules tag or exclude
 * WAF signals rather than allow/block/redirect a request, which has no
 * faithful `UnifiedAction` representation. `fastlyToUnified` skips them
 * (with a debug log, not a translation warning per rule, since this is a
 * rule *category* doorman doesn't manage yet, not a per-rule translation
 * failure) rather than force a lossy mapping.
 */
export interface FastlyRule {
  id: string
  type: FastlyRuleType
  scope: FastlyScope
  enabled: boolean
  description: string
  group_operator: FastlyGroupOperator
  request_logging: 'sampled' | 'none'
  conditions: FastlyConditionItem[]
  actions: FastlyAction[]
  rate_limit?: FastlyRateLimit | null
  created_at: string
  updated_at: string
}

export interface FastlyRulesResponse {
  data: FastlyRule[]
  meta: { limit: number; total: number }
}

/**
 * Input shape for creating/updating a rule. Fastly's own SDK splits
 * `Conditions`/`GroupConditions`/`MultivalConditions` into three separate
 * arrays on the request body rather than one polymorphic array like the
 * response shape — doorman's client mirrors that (see
 * `buildFastlyConditionsPayload` in `translator.ts`) rather than forcing a
 * single shape through both directions.
 */
export interface FastlyRuleInput {
  type: FastlyRuleType
  description: string
  enabled: boolean
  group_operator: FastlyGroupOperator
  request_logging?: 'sampled' | 'none'
  conditions?: FastlySingleCondition[]
  group_conditions?: FastlyGroupCondition[]
  multival_conditions?: FastlyMultivalCondition[]
  actions: FastlyAction[]
  rate_limit?: FastlyRateLimit | null
}

/** A Fastly Next-Gen WAF list — the closest equivalent to an IP allow/block list. */
export interface FastlyList {
  id: string
  name: string
  description: string
  type: 'ip' | 'string' | 'wildcard' | 'country' | 'signal'
  entries: string[]
  reference_id: string
  scope: { type: 'workspace' | 'account' }
  created_at: string
  updated_at: string
}

export interface FastlyListsResponse {
  data: FastlyList[]
  meta: { total: number }
}

export interface FastlyWorkspace {
  id: string
  name: string
  description: string
  mode: string
  created_at: string
  updated_at: string
}
