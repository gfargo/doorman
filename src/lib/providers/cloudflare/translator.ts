import type { CloudflareRule } from '../../types/cloudflare'
import type { UnifiedRule, UnifiedIPRule, UnifiedAction } from '../../types/unified'
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

  const expression = ExpressionBuilder.fromUnifiedConditions(rule.conditions, rule.conditionLogic)

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
    }

    // Add counting expression if specified
    if (rule.action.rateLimit.countingExpression) {
      cloudflareRule.ratelimit.counting_expression = rule.action.rateLimit.countingExpression
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
