/**
 * Google Cloud Armor specific types. These map to the `securityPolicies`
 * resource family of the Compute Engine v1 API
 * (`https://compute.googleapis.com/compute/v1/projects/{project}/global/securityPolicies`)
 * — confirmed against the REST API reference and the v1 discovery document,
 * global policies only (regional/`regionSecurityPolicies` is a separate,
 * out-of-scope resource — see `credentials.ts`'s doc comment).
 *
 * Every mutating method (`insert`/`patch`/`addRule`/`patchRule`/
 * `removeRule`) returns a long-running `Operation`, not the updated
 * resource directly — `CloudArmorClient` polls `globalOperations.get`
 * internally so callers see a synchronous-feeling API, matching
 * Vercel/Cloudflare/Fastly's clients.
 */

export type CloudArmorAction =
  | 'allow'
  | 'deny(403)'
  | 'deny(404)'
  | 'deny(502)'
  | 'rate_based_ban'
  | 'redirect'
  | 'throttle'

/**
 * A CEL-based rule's match — `expr.expression` is the only shape doorman's
 * translator produces or accepts (via `CelExpressionBuilder`/`CelParser`).
 * The alternative `versionedExpr`/`config.srcIpRanges` shape (basic,
 * non-CEL IP-list matching, capped at 10 ranges) exists on the real API but
 * is deliberately not used here — CEL's `inIpRange()`/`==` (already built
 * for custom rules) represents IP conditions with no range cap and no
 * separate code path to maintain.
 */
export interface CloudArmorMatch {
  expr: {
    expression: string
    title?: string
    description?: string
  }
}

export interface CloudArmorRateLimitOptions {
  rateLimitThreshold: { count: number; intervalSec: number }
  /** Always "allow" — the only value the API accepts. */
  conformAction: 'allow'
  exceedAction: string
  enforceOnKey?:
    | 'ALL'
    | 'IP'
    | 'HTTP_HEADER'
    | 'XFF_IP'
    | 'HTTP_COOKIE'
    | 'HTTP_PATH'
    | 'SNI'
    | 'REGION_CODE'
    | 'USER_IP'
  enforceOnKeyName?: string
  banThreshold?: { count: number; intervalSec: number }
  banDurationSec?: number
}

/**
 * A single rule within a security policy. `priority` is simultaneously the
 * rule's evaluation order, its uniqueness constraint (server-rejected if it
 * collides with another rule in the same policy), and its addressing key
 * for `getRule`/`patchRule`/`removeRule` — there is no separate opaque id
 * the way Vercel/Cloudflare/Fastly assign one. Confirmed effectively
 * immutable once created (no "change priority" operation exists; relocating
 * a rule is remove + add under a new priority).
 */
export interface CloudArmorRule {
  priority: number
  description?: string
  match: CloudArmorMatch
  action: CloudArmorAction
  preview?: boolean
  rateLimitOptions?: CloudArmorRateLimitOptions
  redirectOptions?: { type: 'EXTERNAL_302'; target: string }
  preconfiguredWafConfig?: {
    exclusions?: Array<{
      targetRuleSet: string
      targetRuleIds?: string[]
    }>
  }
}

export interface CloudArmorSecurityPolicy {
  id?: string
  name: string
  description?: string
  rules: CloudArmorRule[]
  /** base64 bytes; required (from a prior GET) on `patch` for optimistic-concurrency, else the API returns 412. */
  fingerprint?: string
  selfLink?: string
  creationTimestamp?: string
}

/** `securityPolicies.list`'s response envelope. */
export interface CloudArmorSecurityPolicyListResponse {
  items?: CloudArmorSecurityPolicy[]
  nextPageToken?: string
}

/**
 * A long-running operation, returned by every mutating `securityPolicies`
 * method in place of the resource itself. `CloudArmorClient` polls this
 * internally via `globalOperations.get` until `status === 'DONE'`.
 */
export interface CloudArmorOperation {
  name: string
  status: 'PENDING' | 'RUNNING' | 'DONE'
  httpErrorStatusCode?: number
  httpErrorMessage?: string
  error?: {
    errors: Array<{ code: string; message: string; location?: string }>
  }
  warnings?: Array<{ code: string; message: string }>
}
