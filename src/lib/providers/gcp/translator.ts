import type { CloudArmorAction, CloudArmorRule } from '../../types/gcp'
import type { UnifiedRule, UnifiedIPRule, UnifiedAction } from '../../types/unified'
import type { ActionType } from '../../types/common'
import type { TranslationResult, TranslationWarning } from '../../translators/TranslationTypes'
import { TranslationWarningSystem } from '../../translators/TranslationWarningSystem'
import { CelExpressionBuilder } from '../../translators/CelExpressionBuilder'
import { parseCelExpression, type CelParseResult } from '../../translators/CelParser'
import { ipAddressSchema } from '../../schemas/commonSchemas'

/**
 * GCP Cloud Armor's half of the Cloud Armor <-> Unified translation. Thin —
 * matches `cloudflare/translator.ts`'s shape, since CEL (like wirefilter) is
 * an expression-string DSL, not structured JSON: expression build/parse is
 * fully delegated to `CelExpressionBuilder`/`CelParser`, and this file only
 * handles priority/action/rate-limit/redirect mapping and the IP-rule
 * classification described below.
 *
 * Cloud Armor has no dedicated IP-blocking resource — unlike Vercel/
 * Cloudflare/Fastly, an IP rule is just another entry in the same flat
 * `rules[]` array a custom rule lives in. `looksLikeIpRule` classifies a
 * fetched rule as IP-blocking only if it has *exactly* the shape
 * `unifiedIPToGcp` itself produces (single `ip` condition, `allow`/`deny`
 * action, nothing else) — the same "parse exactly what we emit" discipline
 * `CelParser` already applies to expressions, extended to rule shape.
 */

/**
 * `rule.priority` is required — Cloud Armor's priority space doubles as
 * both evaluation order and the rule's addressing key, so unlike every
 * other provider's translator there is no client-generated id to fall back
 * on. Assigning one to a brand-new local rule that doesn't have one yet is
 * `CloudArmorFirewallService`'s job (it needs visibility across every rule
 * at once, to avoid collisions) — by the time a rule reaches this function,
 * it must already have one.
 */
export function unifiedToGcp(rule: UnifiedRule): TranslationResult<CloudArmorRule> {
  if (rule.priority === undefined) {
    throw new Error(
      `Rule "${rule.name}" has no priority assigned — CloudArmorFirewallService must assign one before calling unifiedToGcp`,
    )
  }

  const warnings: TranslationWarning[] = []
  const expression = CelExpressionBuilder.fromUnifiedConditions(rule.conditions, rule.conditionLogic)
  const { action, actionWarning } = mapUnifiedActionToGcp(rule.action.type, rule.name, rule.id)
  if (actionWarning) warnings.push(actionWarning)

  const gcpRule: CloudArmorRule = {
    priority: rule.priority,
    description: (rule.description || rule.name).slice(0, 64),
    match: { expr: { expression } },
    action,
    preview: rule.action.type === 'log' ? true : undefined,
  }

  if ((action === 'throttle' || action === 'rate_based_ban') && rule.action.rateLimit) {
    const intervalSec = parseWindowToSeconds(rule.action.rateLimit.window)
    gcpRule.rateLimitOptions = {
      rateLimitThreshold: { count: rule.action.rateLimit.requests, intervalSec },
      conformAction: 'allow',
      exceedAction: 'deny(429)',
      enforceOnKey: 'IP',
    }
  } else if (action === 'throttle' && !rule.action.rateLimit) {
    warnings.push(
      TranslationWarningSystem.createWarning(
        'lossy_conversion',
        rule.id,
        'action.rateLimit',
        `Rule "${rule.name}" maps to Cloud Armor's "throttle" action but declares no rateLimit block — Cloud Armor requires rateLimitOptions for this action; the rule will likely be rejected by the API.`,
      ),
    )
  }

  if (action === 'redirect') {
    if (rule.action.redirect) {
      gcpRule.redirectOptions = { type: 'EXTERNAL_302', target: rule.action.redirect.location }
    } else {
      warnings.push(
        TranslationWarningSystem.createWarning(
          'lossy_conversion',
          rule.id,
          'action.redirect',
          `Rule "${rule.name}" maps to Cloud Armor's "redirect" action but declares no redirect target — Cloud Armor requires redirectOptions for this action; the rule will likely be rejected by the API.`,
        ),
      )
    }
  }

  return { result: gcpRule, warnings }
}

export function gcpToUnified(rule: CloudArmorRule, preparsed?: CelParseResult | null): TranslationResult<UnifiedRule> {
  const warnings: TranslationWarning[] = []

  // doorman only ever *writes* CEL itself, so CelParser understands exactly
  // the grammar subset it can produce — anything else (hand-authored, or
  // from another tool) is reported as unparseable (`null`) rather than
  // guessed at, same as WirefilterParser's own precedent (#178).
  //
  // `preparsed` lets a caller that already parsed this same expression once
  // (e.g. translatePolicy, to classify it via looksLikeIpRule first) pass
  // that result through instead of re-running the tokenizer/parser on an
  // identical string — see CloudArmorFirewallService.translatePolicy.
  const parsed = preparsed !== undefined ? preparsed : parseCelExpression(rule.match.expr.expression)

  let conditions: UnifiedRule['conditions'] = []
  let conditionLogic: UnifiedRule['conditionLogic']
  if (parsed) {
    conditions = parsed.conditions
    conditionLogic = parsed.conditionLogic
  } else {
    warnings.push(
      TranslationWarningSystem.createWarning(
        'complex_expressions',
        String(rule.priority),
        'match.expr.expression',
        'CEL expression could not be parsed back into structured conditions — it may be hand-authored or use syntax outside what doorman itself generates.',
        'Review the translated rule and add missing conditions manually if needed.',
      ),
    )
  }

  // Every optional field below is conditionally spread rather than always
  // present with a possibly-`undefined` value — `{ x: undefined }` and
  // omitting `x` entirely are different object shapes to isDeepEqual's
  // Object.keys().length check (it counts keys, not defined-ness), so an
  // unconditional `undefined` here would make getChanges report a phantom
  // "update" for every ordinary rule, on every sync, forever, since a local
  // config loaded from disk never carries a key it was never given a value
  // for. Same bug class the Fastly translator was fixed to avoid — see
  // #203 and .kiro/steering/adding-a-provider.md's "diffing gotcha" note.
  const action: UnifiedAction = {
    type: mapGcpActionToUnified(rule.action),
    ...(rule.rateLimitOptions
      ? {
          rateLimit: {
            requests: rule.rateLimitOptions.rateLimitThreshold.count,
            window: `${rule.rateLimitOptions.rateLimitThreshold.intervalSec}s`,
          },
        }
      : {}),
    ...(rule.redirectOptions ? { redirect: { location: rule.redirectOptions.target } } : {}),
  }

  const unifiedRule: UnifiedRule = {
    id: String(rule.priority),
    name: rule.description || `Rule ${rule.priority}`,
    ...(rule.description ? { description: rule.description } : {}),
    enabled: !rule.preview,
    conditions,
    // 'AND' is UnifiedRule.conditionLogic's own documented default — a
    // local config expressing a plain AND (the common case) never spells
    // it out, so only the non-default 'OR' (or an unparseable expression's
    // `undefined`, itself omitted) is worth carrying as an explicit key.
    ...(conditionLogic === 'OR' ? { conditionLogic } : {}),
    action,
    priority: rule.priority,
  }

  return { result: unifiedRule, warnings }
}

/**
 * A rule with exactly the shape `unifiedIPToGcp` produces — one `ip`
 * condition, an allow/deny action, nothing else layered on. Anything else
 * (extra conditions, a different action, rate limiting) is a custom rule
 * that happens to reference `ip`, not an IP-blocking entry.
 */
export function looksLikeIpRule(rule: CloudArmorRule, preparsed?: CelParseResult | null): boolean {
  if (rule.action !== 'allow' && rule.action !== 'deny(403)') return false
  if (rule.preview) return false
  const parsed = preparsed !== undefined ? preparsed : parseCelExpression(rule.match.expr.expression)
  if (!parsed || parsed.conditions.length !== 1) return false
  const condition = parsed.conditions[0]!
  return condition.field === 'ip' && (condition.operator === 'eq' || condition.operator === 'in') && !condition.key
}

export function gcpToUnifiedIP(rule: CloudArmorRule, preparsed?: CelParseResult | null): UnifiedIPRule {
  const parsed = preparsed !== undefined ? preparsed : parseCelExpression(rule.match.expr.expression)
  const condition = parsed!.conditions[0]!
  const value = condition.value
  return {
    id: String(rule.priority),
    ip: Array.isArray(value) ? String(value[0]) : String(value),
    // Conditionally spread, not unconditionally-possibly-undefined — same
    // isDeepEqual key-count reasoning as gcpToUnified above.
    ...(rule.description ? { notes: rule.description } : {}),
    action: rule.action === 'allow' ? 'allow' : 'deny',
  }
}

/**
 * Translate a unified IP rule to a Cloud Armor rule. `priority` must
 * already be assigned by the caller (same requirement as `unifiedToGcp`,
 * and for the same reason).
 */
export function unifiedIPToGcp(ip: UnifiedIPRule, priority: number): CloudArmorRule {
  if (!ipAddressSchema.safeParse(ip.ip).success) {
    throw new Error(`Invalid IP address or CIDR range: ${ip.ip}`)
  }

  const expression = CelExpressionBuilder.fromUnifiedCondition({ field: 'ip', operator: 'eq', value: ip.ip })

  return {
    priority,
    description: (ip.notes || `IP ${ip.action}: ${ip.ip}${ip.hostname ? ` (${ip.hostname})` : ''}`).slice(0, 64),
    match: { expr: { expression } },
    action: ip.action === 'allow' ? 'allow' : 'deny(403)',
  }
}

function mapGcpActionToUnified(action: CloudArmorAction): ActionType {
  const mapping: Record<CloudArmorAction, ActionType> = {
    allow: 'allow',
    'deny(403)': 'deny',
    'deny(404)': 'deny',
    'deny(502)': 'deny',
    rate_based_ban: 'rate_limit',
    throttle: 'rate_limit',
    redirect: 'redirect',
  }
  return mapping[action] || 'deny'
}

/**
 * Maps a unified action to a Cloud Armor action, warning when the closest
 * available action is a fallback rather than a faithful match (see
 * `CompatibilityMatrix`'s `gcp` entries for `log`/`challenge`/`bypass`,
 * which this mirrors).
 */
function mapUnifiedActionToGcp(
  action: string,
  ruleName: string,
  ruleId: string | undefined,
): { action: CloudArmorAction; actionWarning?: TranslationWarning } {
  switch (action) {
    case 'log':
      // No dedicated log action — represented as `allow` + `preview: true`
      // (evaluates and logs without enforcing). See unifiedToGcp's caller.
      return { action: 'allow' }
    case 'deny':
    case 'block':
      return { action: 'deny(403)' }
    case 'challenge':
      return {
        action: 'deny(403)',
        actionWarning: TranslationWarningSystem.createUnsupportedFeatureWarning(
          'challenge action',
          'unified config',
          'Cloud Armor',
          ruleId,
          'action',
        ),
      }
    case 'bypass':
      return { action: 'allow' }
    case 'rate_limit':
      return { action: 'throttle' }
    case 'redirect':
      return { action: 'redirect' }
    case 'allow':
      return { action: 'allow' }
    default:
      return {
        action: 'deny(403)',
        actionWarning: TranslationWarningSystem.createWarning(
          'lossy_conversion',
          ruleId,
          'action',
          `Rule "${ruleName}" has unrecognized action "${action}" — defaulted to Cloud Armor's "deny(403)".`,
        ),
      }
  }
}

function parseWindowToSeconds(window: string): number {
  const match = window.match(/^(\d+)([smhd])$/)
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid window format: ${window}`)
  }
  const value = parseInt(match[1], 10)
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  const multiplier = multipliers[match[2]]
  if (multiplier === undefined) {
    throw new Error(`Invalid time unit: ${match[2]}`)
  }
  return value * multiplier
}
