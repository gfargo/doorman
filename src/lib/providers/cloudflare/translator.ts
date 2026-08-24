import type { CloudflareRule, CloudflareAction, CloudflareExecuteActionParameters } from '../../types/cloudflare'
import type {
  UnifiedRule,
  UnifiedIPRule,
  UnifiedAction,
  UnifiedManagedRuleGroup,
  UnifiedCondition,
} from '../../types/unified'
import type { ActionType } from '../../types/common'
import type { TranslationResult, TranslationWarning } from '../../translators/TranslationTypes'
import { TranslationWarningSystem } from '../../translators/TranslationWarningSystem'
import { ExpressionBuilder } from '../../translators/ExpressionBuilder'
import { parseWirefilterExpression } from '../../translators/WirefilterParser'
import { ipAddressSchema } from '../../schemas/commonSchemas'

/**
 * Cloudflare's half of the Cloudflare <-> Unified translation. Split out of
 * the former monolithic `RuleTranslator` (#196) so Cloudflare's translation
 * logic lives with the rest of the Cloudflare adapter, and a future
 * provider's translator doesn't have to be added to this file to exist.
 */

/**
 * Translate Cloudflare rule to Unified format
 */
export function cloudflareToUnified(rule: CloudflareRule): TranslationResult<UnifiedRule> {
  const warnings: TranslationWarning[] = []

  // doorman only ever *writes* wirefilter expressions itself, so
  // WirefilterParser understands exactly the grammar subset it can
  // produce — anything else (hand-authored, or from another tool) it
  // reports as unparseable (`null`) rather than guessing, and this falls
  // back to the previous "empty conditions" behavior with a warning.
  const parsed = parseWirefilterExpression(rule.expression)

  let conditions: UnifiedRule['conditions'] = []
  let conditionLogic: UnifiedRule['conditionLogic']
  if (parsed) {
    conditions = parsed.conditions
    conditionLogic = parsed.conditionLogic
  } else {
    warnings.push(
      TranslationWarningSystem.createWarning(
        'complex_expressions',
        rule.id,
        'expression',
        'Expression could not be parsed back into structured conditions — it may be hand-authored or use syntax outside what doorman itself generates.',
        'Review the translated rule and add missing conditions manually if needed.',
      ),
    )
  }

  // Custom block-response body, if this rule carries one. Recovered so
  // `download`/`backup` capture it and a Cloudflare→unified→Cloudflare
  // round trip doesn't silently drop the user's custom block page.
  const blockResponse =
    rule.action_parameters && 'response' in rule.action_parameters ? rule.action_parameters.response : undefined

  const action: UnifiedAction = {
    type: mapCloudflareActionToUnified(rule.action),
    rateLimit: rule.ratelimit
      ? {
          requests: rule.ratelimit.requests_per_period,
          window: `${rule.ratelimit.period}s`,
          characteristics: rule.ratelimit.characteristics,
          mitigationTimeout: rule.ratelimit.mitigation_timeout,
          countingExpression: rule.ratelimit.counting_expression,
        }
      : undefined,
    response: blockResponse
      ? {
          statusCode: blockResponse.status_code,
          content: blockResponse.content,
          contentType: blockResponse.content_type,
        }
      : undefined,
  }

  const unifiedRule: UnifiedRule = {
    id: rule.id,
    name: rule.description || `Rule ${rule.id}`,
    description: rule.description,
    enabled: rule.enabled ?? true,
    conditions,
    conditionLogic,
    action,
  }

  return { result: unifiedRule, warnings }
}

/**
 * Translate Unified rule to Cloudflare
 */
export function unifiedToCloudflare(rule: UnifiedRule): TranslationResult<CloudflareRule> {
  const warnings: TranslationWarning[] = []

  const supportedConditions = filterUnsupportedConditions(rule.conditions, rule.id, warnings)
  if (supportedConditions.length === 0) {
    throw new Error(
      `Rule "${rule.name}" has no conditions Cloudflare can represent — every condition field is unsupported ` +
        'by Cloudflare (e.g. Vercel-only fields like environment/ja3_digest, or vercel_region). Cannot sync this rule to Cloudflare.',
    )
  }

  const expression = ExpressionBuilder.fromUnifiedConditions(supportedConditions, rule.conditionLogic)

  const cloudflareRule: CloudflareRule = {
    id: rule.id || crypto.randomUUID(),
    action: mapUnifiedActionToCloudflare(rule.action.type),
    expression,
    description: rule.description || rule.name,
    enabled: rule.enabled,
  }

  if (rule.action.rateLimit) {
    cloudflareRule.ratelimit = {
      characteristics: rule.action.rateLimit.characteristics || ['ip.src'],
      period: parseWindowToSeconds(rule.action.rateLimit.window),
      requests_per_period: rule.action.rateLimit.requests,
    }

    // Add mitigation timeout if specified (in seconds)
    if (rule.action.rateLimit.mitigationTimeout) {
      cloudflareRule.ratelimit.mitigation_timeout = rule.action.rateLimit.mitigationTimeout
    } else {
      // Default to 1 hour (3600 seconds) for rate limit blocks
      cloudflareRule.ratelimit.mitigation_timeout = 3600
      warnings.push(
        TranslationWarningSystem.createWarning(
          'rate_limiting_precision',
          rule.id,
          'action.rateLimit.mitigationTimeout',
          `No mitigationTimeout set for rate limit rule "${rule.name}" — defaulted to Cloudflare's 3600s (1 hour) block duration.`,
        ),
      )
    }

    // Add counting expression if specified
    if (rule.action.rateLimit.countingExpression) {
      cloudflareRule.ratelimit.counting_expression = rule.action.rateLimit.countingExpression
    }
  }

  // Redirect target. Without this, a translated redirect rule reaches
  // Cloudflare as `action: 'redirect'` with no destination at all — an
  // incomplete rule the API is likely to reject outright, or silently
  // accept as a redirect-to-nowhere. See #199. Prefers an explicit
  // `statusCode` (redirectSchema supports any 3xx) over the permanent-only
  // 301/302 the previous (dead, since-removed) vercelToCloudflare code
  // used, since the unified type carries more precision than that.
  if (rule.action.type === 'redirect' && rule.action.redirect) {
    cloudflareRule.action_parameters = {
      from_value: {
        status_code: rule.action.redirect.statusCode ?? (rule.action.redirect.permanent ? 301 : 302),
        target_url: { value: rule.action.redirect.location },
        ...(rule.action.redirect.preserveQueryString !== undefined
          ? { preserve_query_string: rule.action.redirect.preserveQueryString }
          : {}),
      },
    }
  }

  // Custom response body. Cloudflare only accepts this on `block` actions,
  // and requires all three fields together — so `content` is the trigger
  // (there's no custom response without a body) and the other two get
  // Cloudflare's own defaults when omitted.
  if (rule.action.response) {
    if (cloudflareRule.action !== 'block') {
      warnings.push(
        TranslationWarningSystem.createUnsupportedFeatureWarning(
          `custom response on a '${cloudflareRule.action}' action`,
          'unified config',
          'Cloudflare',
          rule.id,
          'action.response',
        ),
      )
    } else if (!rule.action.response.content) {
      warnings.push(
        TranslationWarningSystem.createWarning(
          'lossy_conversion',
          rule.id,
          'action.response',
          'Custom response declared without `content`; Cloudflare requires a response body, so it was dropped.',
          'Set action.response.content to the body you want returned.',
        ),
      )
    } else {
      cloudflareRule.action_parameters = {
        response: {
          status_code: rule.action.response.statusCode ?? 403,
          content: rule.action.response.content,
          content_type: rule.action.response.contentType ?? 'text/plain',
        },
      }
    }
  }

  return { result: cloudflareRule, warnings }
}

/**
 * Translate Unified IP rule to Cloudflare rule
 */
export function unifiedIPToCloudflare(ip: UnifiedIPRule): CloudflareRule {
  // `ip.ip` is interpolated unquoted into the wirefilter expression below (IP
  // literals aren't string literals in wirefilter, so there are no quotes to
  // escape). Config-level schema validation already constrains this value in
  // normal usage, but this function shouldn't trust its input blindly — an
  // unvalidated value here has no delimiter at all to contain it, making this
  // a more direct injection primitive than a quoted string field.
  if (!ipAddressSchema.safeParse(ip.ip).success) {
    throw new Error(`Invalid IP address or CIDR range: ${ip.ip}`)
  }

  // wirefilter's `eq` only matches a single IP literal — a CIDR range needs
  // the `in {…}` set-membership operator instead, or Cloudflare's ruleset
  // API rejects the rule outright.
  const isCIDR = ip.ip.includes('/')
  const expression = isCIDR ? `ip.src in {${ip.ip}}` : `ip.src eq ${ip.ip}`

  return {
    id: ip.id || crypto.randomUUID(),
    action: ip.action === 'allow' ? 'allow' : 'block',
    expression,
    description: ip.notes || `IP ${ip.action}: ${ip.ip}${ip.hostname ? ` (${ip.hostname})` : ''}`,
    enabled: true,
  }
}

/**
 * Translate a Unified managed rule group to a Cloudflare `execute` rule.
 * Deploys via a phase-entrypoint ruleset the same way custom rules do, just
 * targeting `http_request_firewall_managed` instead of
 * `http_request_firewall_custom` — see CloudflareClient.getOrCreateManagedRulesRuleset.
 * `expression: 'true'` means the ruleset applies to every request; doorman
 * doesn't currently expose a way to scope *when* a managed ruleset applies,
 * only whether it's enabled and how its own rules are overridden (#183).
 */
export function unifiedManagedRuleGroupToCloudflare(group: UnifiedManagedRuleGroup): TranslationResult<CloudflareRule> {
  const warnings: TranslationWarning[] = []
  const overrides: NonNullable<CloudflareExecuteActionParameters['overrides']> = {}

  if (group.action) {
    const { action, warning } = mapUnifiedActionToManagedRuleOverride(group.action, group.id, 'action')
    if (warning) warnings.push(warning)
    if (action) overrides.action = action
  }

  if (group.overrides && group.overrides.length > 0) {
    overrides.rules = group.overrides.map((override) => {
      const ruleOverride: { id: string; action?: CloudflareAction; enabled?: boolean } = { id: override.ruleId }
      if (override.enabled !== undefined) ruleOverride.enabled = override.enabled
      if (override.action) {
        const { action, warning } = mapUnifiedActionToManagedRuleOverride(
          override.action,
          group.id,
          `overrides[${override.ruleId}].action`,
        )
        if (warning) warnings.push(warning)
        if (action) ruleOverride.action = action
      }
      return ruleOverride
    })
  }

  const actionParameters: CloudflareExecuteActionParameters = {
    id: group.ruleset,
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
  }

  const cloudflareRule: CloudflareRule = {
    id: group.id || crypto.randomUUID(),
    action: 'execute',
    expression: 'true',
    description: group.name || `Managed ruleset ${group.ruleset}`,
    enabled: group.enabled,
    action_parameters: actionParameters,
  }

  return { result: cloudflareRule, warnings }
}

/**
 * Translate a Cloudflare `execute` rule back to a Unified managed rule group.
 */
export function cloudflareToUnifiedManagedRuleGroup(rule: CloudflareRule): TranslationResult<UnifiedManagedRuleGroup> {
  const warnings: TranslationWarning[] = []
  const params = rule.action_parameters as CloudflareExecuteActionParameters | undefined

  const group: UnifiedManagedRuleGroup = {
    id: rule.id,
    ruleset: params?.id ?? '',
    enabled: rule.enabled ?? true,
    ...(rule.description ? { name: rule.description } : {}),
  }

  if (params?.overrides?.action) {
    group.action = mapManagedRuleOverrideActionToUnified(params.overrides.action)
  }

  if (params?.overrides?.rules && params.overrides.rules.length > 0) {
    group.overrides = params.overrides.rules.map((override) => ({
      ruleId: override.id,
      ...(override.action !== undefined ? { action: mapManagedRuleOverrideActionToUnified(override.action) } : {}),
      ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
    }))
  }

  return { result: group, warnings }
}

/**
 * Managed-ruleset overrides accept a narrower action set than an ordinary
 * custom rule — they're overriding a single WAF signature rule's response,
 * not building general rule logic, so `bypass`(skip)/`rate_limit`/`redirect`
 * don't apply. Deliberately separate from mapUnifiedActionToCloudflare
 * rather than reusing it, so an unsupported value is caught and warned about
 * here instead of silently producing an override Cloudflare's API rejects.
 */
function mapUnifiedActionToManagedRuleOverride(
  action: ActionType,
  ruleId: string | undefined,
  field: string,
): { action?: CloudflareAction; warning?: TranslationWarning } {
  const mapping: Partial<Record<ActionType, CloudflareAction>> = {
    log: 'log',
    deny: 'block',
    block: 'block',
    challenge: 'managed_challenge',
    allow: 'allow',
  }

  const mapped = mapping[action]
  if (mapped) return { action: mapped }

  return {
    warning: TranslationWarningSystem.createUnsupportedFeatureWarning(
      `'${action}' as a managed-ruleset override action`,
      'unified config',
      'Cloudflare',
      ruleId,
      field,
    ),
  }
}

function mapManagedRuleOverrideActionToUnified(action: CloudflareAction): ActionType {
  const mapping: Partial<Record<CloudflareAction, ActionType>> = {
    log: 'log',
    block: 'deny',
    challenge: 'challenge',
    managed_challenge: 'challenge',
    js_challenge: 'challenge',
    allow: 'allow',
  }

  return mapping[action] || 'deny'
}

function mapCloudflareActionToUnified(action: CloudflareRule['action']): ActionType {
  const mapping: Record<CloudflareRule['action'], ActionType> = {
    block: 'deny',
    challenge: 'challenge',
    managed_challenge: 'challenge',
    js_challenge: 'challenge',
    log: 'log',
    skip: 'bypass',
    allow: 'allow',
    rewrite: 'bypass',
    redirect: 'redirect',
    // Unreachable in practice: `execute` rules deploy managed rulesets and
    // live only in the http_request_firewall_managed phase ruleset, which
    // this function never sees — CloudflareFirewallService.fetchConfig only
    // passes custom-rules-phase rules through cloudflareToUnified.
    // cloudflareToUnifiedManagedRuleGroup (#183) handles execute rules.
    // Present only to satisfy Record's exhaustiveness over CloudflareAction.
    execute: 'log',
  }

  return mapping[action] || 'deny'
}

function mapUnifiedActionToCloudflare(action: string): CloudflareRule['action'] {
  const mapping: Record<string, CloudflareRule['action']> = {
    log: 'log',
    deny: 'block',
    block: 'block',
    challenge: 'managed_challenge',
    bypass: 'skip',
    rate_limit: 'block',
    redirect: 'redirect',
    allow: 'allow',
  }

  return mapping[action] || 'block'
}

/**
 * Drops conditions whose field has no Cloudflare equivalent, warning for
 * each one, instead of letting them reach `ExpressionBuilder` and either
 * throw or (before #273) silently emit an invalid or semantically-wrong
 * wirefilter expression. Mirrors `buildVercelConditionGroups`'s identical
 * per-condition filter-and-warn loop (providers/vercel/translator.ts).
 */
function filterUnsupportedConditions(
  conditions: UnifiedCondition[],
  ruleId: string | undefined,
  warnings: TranslationWarning[],
): UnifiedCondition[] {
  return conditions.filter((condition) => {
    if (ExpressionBuilder.isFieldSupported(condition.field)) {
      return true
    }
    warnings.push(
      TranslationWarningSystem.createUnsupportedFeatureWarning(
        `condition field '${condition.field}'`,
        'unified config',
        'Cloudflare',
        ruleId,
        condition.field,
      ),
    )
    return false
  })
}

function parseWindowToSeconds(window: string): number {
  const match = window.match(/^(\d+)([smhd])$/)
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid window format: ${window}`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  }

  const multiplier = multipliers[unit]
  if (multiplier === undefined) {
    throw new Error(`Invalid time unit: ${unit}`)
  }

  return value * multiplier
}
