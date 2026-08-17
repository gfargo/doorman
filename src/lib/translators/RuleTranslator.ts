import type { VercelCustomRule, VercelIPBlockingRule, VercelConditionGroup } from '../types/vercel'
import type { CloudflareRule } from '../types/cloudflare'
import type { UnifiedRule, UnifiedIPRule, UnifiedCondition, UnifiedAction } from '../types/unified'
import { ExpressionBuilder } from './ExpressionBuilder'
import { ipAddressSchema } from '../schemas/commonSchemas'
import { logger } from '../logger'

/**
 * Translation warning severity levels
 */
export type TranslationWarningSeverity = 'critical' | 'warning' | 'info'

/**
 * Translation warning categories for better organization
 */
export type TranslationWarningCategory =
  | 'feature_unsupported'
  | 'lossy_conversion'
  | 'syntax_limitation'
  | 'performance_impact'
  | 'security_consideration'
  | 'compatibility_issue'

/**
 * Enhanced translation warnings with severity levels and actionable suggestions
 */
export interface TranslationWarning {
  rule?: string
  field?: string
  category: TranslationWarningCategory
  message: string
  explanation: string
  severity: TranslationWarningSeverity
  suggestion?: string
  alternativeApproach?: string
  impact?: string
  docsUrl?: string
}

/**
 * Translation result
 */
export interface TranslationResult<T> {
  result: T
  warnings: TranslationWarning[]
}

/**
 * Rule translator between different firewall providers
 * Handles bidirectional translation: Vercel ↔ Cloudflare ↔ Unified
 */
export class RuleTranslator {
  /**
   * Translate Vercel rule to Cloudflare rule
   */
  public static vercelToCloudflare(rule: VercelCustomRule): TranslationResult<CloudflareRule> {
    const warnings: TranslationWarning[] = []

    try {
      // Build expression from Vercel condition groups
      const expression = ExpressionBuilder.fromVercelConditionGroups(rule.conditionGroup)

      // Translate action
      const action = this.translateVercelActionToCloudflare(rule.action.mitigate.action)

      // Build Cloudflare rule
      const cloudflareRule: CloudflareRule = {
        id: rule.id || crypto.randomUUID(),
        action,
        expression,
        description: rule.description || rule.name,
        enabled: rule.active,
      }

      // Add rate limit if present
      if (rule.action.mitigate.action === 'rate_limit' && rule.action.mitigate.rateLimit) {
        const rateLimitConfig = rule.action.mitigate.rateLimit
        cloudflareRule.ratelimit = {
          characteristics: rateLimitConfig.characteristics || ['ip.src'],
          period: this.parseWindowToSeconds(rateLimitConfig.window),
          requests_per_period: rateLimitConfig.requests,
        }

        // Add mitigation timeout if specified (in seconds)
        if (rateLimitConfig.mitigationTimeout) {
          cloudflareRule.ratelimit.mitigation_timeout = rateLimitConfig.mitigationTimeout
        } else {
          // Default to 1 hour (3600 seconds) for rate limit blocks
          cloudflareRule.ratelimit.mitigation_timeout = 3600

          // Import the warning system
          const { TranslationWarningSystem } = require('./TranslationWarningSystem')
          warnings.push(
            TranslationWarningSystem.createWarning(
              'rate_limiting_precision',
              rule.id,
              'rateLimit.mitigationTimeout',
              'No mitigation timeout specified, using default 1 hour (3600 seconds)',
              'Specify mitigationTimeout in your rate limit configuration for precise control',
            ),
          )
        }

        // Add counting expression if specified
        if (rateLimitConfig.countingExpression) {
          cloudflareRule.ratelimit.counting_expression = rateLimitConfig.countingExpression
        }
      }

      // Add redirect if present
      if (rule.action.mitigate.action === 'redirect' && rule.action.mitigate.redirect) {
        cloudflareRule.action_parameters = {
          from_value: {
            status_code: rule.action.mitigate.redirect.permanent ? 301 : 302,
            target_url: {
              value: rule.action.mitigate.redirect.location,
            },
          },
        }
      }

      return { result: cloudflareRule, warnings }
    } catch (error) {
      logger.error(`Failed to translate Vercel rule to Cloudflare: ${error}`)
      throw error
    }
  }

  /**
   * Translate Cloudflare rule to Vercel rule
   */
  public static cloudflareToVercel(rule: CloudflareRule): TranslationResult<VercelCustomRule> {
    const warnings: TranslationWarning[] = []

    // Import the warning system
    const { TranslationWarningSystem } = require('./TranslationWarningSystem')

    warnings.push(
      TranslationWarningSystem.createLossyConversionWarning(
        'Cloudflare expression',
        'Cloudflare expressions cannot be perfectly converted to Vercel structured conditions',
        rule.id,
        'expression',
      ),
    )

    // For now, create a basic Vercel rule
    // Full expression parsing would require a wirefilter parser
    const vercelRule: VercelCustomRule = {
      id: rule.id,
      name: rule.description || `Rule ${rule.id}`,
      description: rule.description,
      conditionGroup: [
        {
          conditions: [],
        },
      ],
      action: {
        mitigate: {
          action: this.translateCloudflareActionToVercel(rule.action),
        },
      },
      active: rule.enabled ?? true,
    }

    return { result: vercelRule, warnings }
  }

  /**
   * Translate Vercel rule to Unified format
   */
  public static vercelToUnified(rule: VercelCustomRule): TranslationResult<UnifiedRule> {
    const warnings: TranslationWarning[] = []
    const conditions: UnifiedCondition[] = []

    // Flatten condition groups into unified conditions
    for (const group of rule.conditionGroup) {
      for (const condition of group.conditions) {
        const operator = this.mapVercelOperatorToUnified(condition.op)

        // Check for regex patterns and warn about potential compatibility issues
        if (condition.op === 're' && typeof condition.value === 'string') {
          const { TranslationWarningSystem } = require('./TranslationWarningSystem')
          warnings.push(
            TranslationWarningSystem.createWarning(
              'regex_patterns',
              rule.id,
              condition.type,
              `Regular expression pattern may need adjustment for target provider: ${condition.value}`,
              'Test the regex pattern in the target provider and adjust syntax if needed',
            ),
          )
        }

        conditions.push({
          field: this.mapVercelTypeToUnified(condition.type),
          operator,
          value: condition.value as string | number | string[] | number[],
          negated: condition.neg,
          key: condition.key,
        })
      }
    }

    // Warn about complex rules with many conditions
    if (conditions.length > 10) {
      const { TranslationWarningSystem } = require('./TranslationWarningSystem')
      warnings.push(
        TranslationWarningSystem.createWarning(
          'many_conditions',
          rule.id,
          undefined,
          `Rule has ${conditions.length} conditions which may impact performance`,
          'Consider splitting complex rules into multiple simpler rules for better performance',
        ),
      )
    }

    const action: UnifiedAction = {
      type: rule.action.mitigate.action,
      rateLimit: rule.action.mitigate.rateLimit
        ? {
            requests: rule.action.mitigate.rateLimit.requests,
            window: rule.action.mitigate.rateLimit.window,
            characteristics: rule.action.mitigate.rateLimit.characteristics,
            mitigationTimeout: rule.action.mitigate.rateLimit.mitigationTimeout,
            countingExpression: rule.action.mitigate.rateLimit.countingExpression,
          }
        : undefined,
      redirect: rule.action.mitigate.redirect
        ? {
            location: rule.action.mitigate.redirect.location,
            permanent: rule.action.mitigate.redirect.permanent,
          }
        : undefined,
      duration: rule.action.mitigate.actionDuration || undefined,
    }

    const unifiedRule: UnifiedRule = {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      enabled: rule.active,
      conditions,
      conditionLogic: 'OR', // Vercel uses OR between groups
      action,
    }

    return { result: unifiedRule, warnings }
  }

  /**
   * Translate Cloudflare rule to Unified format
   */
  public static cloudflareToUnified(rule: CloudflareRule): TranslationResult<UnifiedRule> {
    const warnings: TranslationWarning[] = []

    // Import the warning system
    const { TranslationWarningSystem } = require('./TranslationWarningSystem')

    warnings.push(
      TranslationWarningSystem.createWarning(
        'complex_expressions',
        rule.id,
        'expression',
        'Expression parsing not fully implemented. Using simplified translation.',
        'Review the translated rule and add missing conditions manually if needed.',
      ),
    )

    const action: UnifiedAction = {
      type: this.mapCloudflareActionToUnified(rule.action),
      rateLimit: rule.ratelimit
        ? {
            requests: rule.ratelimit.requests_per_period,
            window: `${rule.ratelimit.period}s`,
            characteristics: rule.ratelimit.characteristics,
            mitigationTimeout: rule.ratelimit.mitigation_timeout,
            countingExpression: rule.ratelimit.counting_expression,
          }
        : undefined,
    }

    const unifiedRule: UnifiedRule = {
      id: rule.id,
      name: rule.description || `Rule ${rule.id}`,
      description: rule.description,
      enabled: rule.enabled ?? true,
      conditions: [], // Would need expression parser
      action,
    }

    return { result: unifiedRule, warnings }
  }

  /**
   * Translate Unified rule to Cloudflare
   */
  public static unifiedToCloudflare(rule: UnifiedRule): TranslationResult<CloudflareRule> {
    const warnings: TranslationWarning[] = []

    const expression = ExpressionBuilder.fromUnifiedConditions(rule.conditions, rule.conditionLogic)

    const cloudflareRule: CloudflareRule = {
      id: rule.id || crypto.randomUUID(),
      action: this.mapUnifiedActionToCloudflare(rule.action.type),
      expression,
      description: rule.description || rule.name,
      enabled: rule.enabled,
    }

    if (rule.action.rateLimit) {
      cloudflareRule.ratelimit = {
        characteristics: rule.action.rateLimit.characteristics || ['ip.src'],
        period: this.parseWindowToSeconds(rule.action.rateLimit.window),
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

    return { result: cloudflareRule, warnings }
  }

  /**
   * Translate Unified rule to Vercel
   */
  public static unifiedToVercel(rule: UnifiedRule): TranslationResult<VercelCustomRule> {
    const warnings: TranslationWarning[] = []
    const conditionGroups: VercelConditionGroup[] = []

    // Convert unified conditions to Vercel condition groups
    const conditions = rule.conditions.map((condition) => ({
      op: this.mapUnifiedOperatorToVercel(condition.operator),
      neg: condition.negated,
      type: this.mapUnifiedTypeToVercel(condition.field),
      key: condition.key,
      value: condition.value,
    }))

    conditionGroups.push({ conditions })

    const vercelRule: VercelCustomRule = {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      conditionGroup: conditionGroups,
      action: {
        mitigate: {
          action: rule.action.type,
          rateLimit: rule.action.rateLimit
            ? {
                requests: rule.action.rateLimit.requests,
                window: rule.action.rateLimit.window,
                characteristics: rule.action.rateLimit.characteristics,
                mitigationTimeout: rule.action.rateLimit.mitigationTimeout,
                countingExpression: rule.action.rateLimit.countingExpression,
              }
            : null,
          redirect: rule.action.redirect
            ? {
                location: rule.action.redirect.location,
                permanent: rule.action.redirect.permanent,
              }
            : null,
          actionDuration: rule.action.duration || null,
        },
      },
      active: rule.enabled,
    }

    return { result: vercelRule, warnings }
  }

  /**
   * Translate Vercel IP rule to Unified
   */
  public static vercelIPToUnified(ip: VercelIPBlockingRule): UnifiedIPRule {
    return {
      id: ip.id,
      ip: ip.ip,
      hostname: ip.hostname,
      notes: ip.notes,
      action: ip.action,
    }
  }

  /**
   * Translate Unified IP rule to Cloudflare rule
   */
  public static unifiedIPToCloudflare(ip: UnifiedIPRule): CloudflareRule {
    // `ip.ip` is interpolated unquoted into the wirefilter expression below (IP
    // literals aren't string literals in wirefilter, so there are no quotes to
    // escape). Config-level schema validation already constrains this value in
    // normal usage, but this function shouldn't trust its input blindly — an
    // unvalidated value here has no delimiter at all to contain it, making this
    // a more direct injection primitive than a quoted string field.
    if (!ipAddressSchema.safeParse(ip.ip).success) {
      throw new Error(`Invalid IP address or CIDR range: ${ip.ip}`)
    }

    return {
      id: ip.id || crypto.randomUUID(),
      action: ip.action === 'allow' ? 'allow' : 'block',
      expression: `ip.src eq ${ip.ip}`,
      description: ip.notes || `IP ${ip.action}: ${ip.ip}${ip.hostname ? ` (${ip.hostname})` : ''}`,
      enabled: true,
    }
  }

  // Helper methods

  private static translateVercelActionToCloudflare(action: string): CloudflareRule['action'] {
    const mapping: Record<string, CloudflareRule['action']> = {
      log: 'log',
      deny: 'block',
      challenge: 'managed_challenge',
      bypass: 'skip',
      rate_limit: 'block',
      redirect: 'redirect',
    }

    return mapping[action] || 'block'
  }

  private static translateCloudflareActionToVercel(
    action: CloudflareRule['action'],
  ): import('../types/common').ActionType {
    const mapping: Record<CloudflareRule['action'], import('../types/common').ActionType> = {
      block: 'deny',
      challenge: 'challenge',
      managed_challenge: 'challenge',
      js_challenge: 'challenge',
      log: 'log',
      skip: 'bypass',
      allow: 'bypass',
      rewrite: 'bypass',
      redirect: 'redirect',
    }

    return mapping[action] || 'deny'
  }

  private static mapVercelOperatorToUnified(op: string): import('../types/common').Operator {
    const mapping: Record<string, import('../types/common').Operator> = {
      eq: 'eq',
      pre: 'starts_with',
      suf: 'ends_with',
      inc: 'in',
      sub: 'contains',
      re: 'matches',
      ex: 'exists',
      nex: 'not_exists',
    }

    return mapping[op] || 'eq'
  }

  private static mapUnifiedOperatorToVercel(op: string): import('../types/vercel').VercelRuleOperator {
    const mapping: Record<string, import('../types/vercel').VercelRuleOperator> = {
      eq: 'eq',
      starts_with: 'pre',
      ends_with: 'suf',
      in: 'inc',
      contains: 'sub',
      matches: 're',
      exists: 'ex',
      not_exists: 'nex',
    }

    return mapping[op] || 'eq'
  }

  private static mapVercelTypeToUnified(type: string): string {
    const mapping: Record<string, string> = {
      host: 'host',
      path: 'path',
      method: 'method',
      header: 'header',
      query: 'query',
      cookie: 'cookie',
      ip_address: 'ip',
      user_agent: 'user_agent',
      geo_country: 'country',
      geo_city: 'city',
      geo_as_number: 'asn',
      scheme: 'scheme',
    }

    return mapping[type] || type
  }

  private static mapUnifiedTypeToVercel(type: string): import('../types/vercel').VercelRuleType {
    const mapping: Record<string, import('../types/vercel').VercelRuleType> = {
      host: 'host',
      path: 'path',
      method: 'method',
      header: 'header',
      query: 'query',
      cookie: 'cookie',
      ip: 'ip_address',
      user_agent: 'user_agent',
      country: 'geo_country',
      city: 'geo_city',
      asn: 'geo_as_number',
      scheme: 'scheme',
    }

    return mapping[type] || 'path'
  }

  private static mapCloudflareActionToUnified(action: CloudflareRule['action']): import('../types/common').ActionType {
    const mapping: Record<CloudflareRule['action'], import('../types/common').ActionType> = {
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

  private static mapUnifiedActionToCloudflare(action: string): CloudflareRule['action'] {
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

  private static parseWindowToSeconds(window: string): number {
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
}
