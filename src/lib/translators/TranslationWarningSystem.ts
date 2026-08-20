import type { TranslationWarning, TranslationWarningSeverity, TranslationWarningCategory } from './TranslationTypes'

/**
 * Translation warning configuration for different scenarios
 */
interface WarningConfig {
  category: TranslationWarningCategory
  severity: TranslationWarningSeverity
  explanation: string
  suggestion?: string
  alternativeApproach?: string
  impact?: string
  docsUrl?: string
}

/**
 * Enhanced translation warning system with comprehensive messaging and suggestions
 * Provides detailed explanations of translation limitations and alternative approaches
 */
export class TranslationWarningSystem {
  private static readonly DOCS_BASE_URL = 'https://docs.doorman.griffen.codes'

  /**
   * Predefined warning configurations for common translation scenarios
   */
  private static readonly WARNING_CONFIGS: Record<string, WarningConfig> = {
    // Feature unsupported warnings
    managed_rules: {
      category: 'feature_unsupported',
      severity: 'critical',
      explanation:
        'Managed rules are provider-specific security rules that cannot be directly translated between platforms.',
      suggestion: 'Replace with custom rules using equivalent conditions and actions.',
      alternativeApproach:
        'Create custom rules that match the same traffic patterns using standard conditions like IP, country, user agent, or request headers.',
      impact: 'Security coverage may be reduced until equivalent custom rules are implemented.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/managed-rules`,
    },

    bot_management: {
      category: 'feature_unsupported',
      severity: 'critical',
      explanation: 'Bot management features use provider-specific detection algorithms that cannot be translated.',
      suggestion: 'Configure bot management separately in the target provider.',
      alternativeApproach:
        'Use user agent filtering, rate limiting, and challenge actions to implement basic bot protection.',
      impact: 'Bot protection effectiveness may vary between providers.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/bot-management`,
    },

    // Lossy conversion warnings
    complex_expressions: {
      category: 'lossy_conversion',
      severity: 'warning',
      explanation:
        'Complex expressions may not translate perfectly due to differences in syntax and supported operators between providers.',
      suggestion: 'Review translated expressions and test thoroughly before deploying.',
      alternativeApproach: 'Break complex expressions into simpler, more portable conditions.',
      impact: 'Rule behavior may differ slightly from the original configuration.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/expressions`,
    },

    geo_blocking: {
      category: 'lossy_conversion',
      severity: 'warning',
      explanation: 'Geographic blocking may use different country codes or geographic databases between providers.',
      suggestion: 'Verify country codes and geographic targeting after translation.',
      alternativeApproach: 'Use ISO country codes when possible for better compatibility.',
      impact: 'Some geographic regions may be blocked or allowed differently than intended.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/geo-blocking`,
    },

    rate_limiting_precision: {
      category: 'lossy_conversion',
      severity: 'info',
      explanation:
        "Rate limiting configurations may be adjusted to match the target provider's supported time windows and request thresholds.",
      suggestion: 'Review rate limiting settings and adjust if necessary.',
      alternativeApproach: 'Use the closest supported time window and request threshold values.',
      impact: 'Rate limiting may be slightly more or less restrictive than the original configuration.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/rate-limiting`,
    },

    // Syntax limitation warnings
    regex_patterns: {
      category: 'syntax_limitation',
      severity: 'warning',
      explanation:
        'Regular expression patterns may have different syntax requirements or feature support between providers.',
      suggestion: 'Test regex patterns in the target provider and adjust syntax if needed.',
      alternativeApproach: 'Use simpler string matching operations (contains, starts_with, ends_with) when possible.',
      impact: 'Pattern matching may behave differently or fail to match intended traffic.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/regex-patterns`,
    },

    header_manipulation: {
      category: 'syntax_limitation',
      severity: 'warning',
      explanation:
        'Header manipulation capabilities vary between providers in terms of supported headers and modification types.',
      suggestion: 'Verify header modification support in the target provider.',
      alternativeApproach: 'Use redirect rules or custom error pages to achieve similar functionality.',
      impact: 'Header modifications may not work as expected or may be ignored.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/headers`,
    },

    // Performance impact warnings
    large_ip_lists: {
      category: 'performance_impact',
      severity: 'info',
      explanation: 'Large IP lists may impact rule evaluation performance differently between providers.',
      suggestion: 'Consider using provider-specific IP list features for better performance.',
      alternativeApproach:
        'Break large IP lists into smaller, more targeted rules or use CIDR notation to reduce list size.',
      impact: 'Rule evaluation may be slower with large IP lists, potentially affecting site performance.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/ip-lists`,
    },

    many_conditions: {
      category: 'performance_impact',
      severity: 'info',
      explanation: 'Rules with many conditions may have different performance characteristics between providers.',
      suggestion: 'Monitor rule performance and consider optimizing complex rules.',
      alternativeApproach: 'Split complex rules into multiple simpler rules or use more efficient condition types.',
      impact: 'Complex rules may impact request processing speed.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/rule-optimization`,
    },

    // Security consideration warnings
    action_differences: {
      category: 'security_consideration',
      severity: 'warning',
      explanation:
        'Security actions (block, challenge, etc.) may behave differently between providers in terms of user experience and effectiveness.',
      suggestion: 'Test security actions thoroughly and adjust based on provider capabilities.',
      alternativeApproach: 'Use the most appropriate equivalent action available in the target provider.',
      impact: 'Security effectiveness and user experience may differ from the original configuration.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/security-actions`,
    },

    challenge_types: {
      category: 'security_consideration',
      severity: 'info',
      explanation: 'Challenge types (CAPTCHA, JavaScript, etc.) vary between providers and may affect user experience.',
      suggestion: 'Choose challenge types that balance security and user experience for your use case.',
      alternativeApproach: "Use the provider's recommended challenge type for your security requirements.",
      impact: 'User experience during security challenges may vary.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/challenges`,
    },

    // Compatibility issue warnings
    version_compatibility: {
      category: 'compatibility_issue',
      severity: 'warning',
      explanation: 'Some features may only be available in specific provider plan tiers or API versions.',
      suggestion: 'Verify feature availability in your target provider plan.',
      alternativeApproach: 'Use alternative features available in your plan tier.',
      impact: 'Some rules may not work as expected if required features are unavailable.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/compatibility`,
    },

    plan_limitations: {
      category: 'compatibility_issue',
      severity: 'critical',
      explanation: 'Your current plan may not support all features being translated.',
      suggestion: 'Upgrade your plan or modify rules to use available features.',
      alternativeApproach: 'Implement equivalent functionality using features available in your current plan.',
      impact: 'Rules may be rejected or ignored if they use unavailable features.',
      docsUrl: `${TranslationWarningSystem.DOCS_BASE_URL}/migration/plan-limits`,
    },
  }

  /**
   * Create a translation warning with comprehensive details
   */
  public static createWarning(
    key: string,
    rule?: string,
    field?: string,
    customMessage?: string,
    customSuggestion?: string,
  ): TranslationWarning {
    const config = this.WARNING_CONFIGS[key]

    if (!config) {
      // Fallback for unknown warning types
      return {
        rule,
        field,
        category: 'compatibility_issue',
        message: customMessage || `Unknown translation issue: ${key}`,
        explanation: 'This translation scenario is not fully documented.',
        severity: 'warning',
        suggestion: customSuggestion || 'Review the translated configuration manually and test thoroughly.',
        docsUrl: `${this.DOCS_BASE_URL}/migration/troubleshooting`,
      }
    }

    return {
      rule,
      field,
      category: config.category,
      message: customMessage || `${key.replace(/_/g, ' ')} translation issue`,
      explanation: config.explanation,
      severity: config.severity,
      suggestion: customSuggestion || config.suggestion,
      alternativeApproach: config.alternativeApproach,
      impact: config.impact,
      docsUrl: config.docsUrl,
    }
  }

  /**
   * Create a warning for unsupported features
   */
  public static createUnsupportedFeatureWarning(
    feature: string,
    sourceProvider: string,
    targetProvider: string,
    rule?: string,
    field?: string,
  ): TranslationWarning {
    return {
      rule,
      field,
      category: 'feature_unsupported',
      message: `${feature} is not supported in ${targetProvider}`,
      explanation: `The ${feature} feature from ${sourceProvider} cannot be directly translated to ${targetProvider} due to platform differences.`,
      severity: 'critical',
      suggestion: `Remove or replace ${feature} with equivalent functionality supported by ${targetProvider}.`,
      alternativeApproach: `Check ${targetProvider} documentation for similar features or use custom rules to achieve equivalent functionality.`,
      impact: 'This rule may not work as expected or may be ignored entirely.',
      docsUrl: `${this.DOCS_BASE_URL}/migration/unsupported-features`,
    }
  }

  /**
   * Create a warning for lossy conversions
   */
  public static createLossyConversionWarning(
    feature: string,
    reason: string,
    rule?: string,
    field?: string,
  ): TranslationWarning {
    return {
      rule,
      field,
      category: 'lossy_conversion',
      message: `${feature} translation may be lossy`,
      explanation: `The ${feature} configuration cannot be perfectly translated: ${reason}`,
      severity: 'warning',
      suggestion: 'Review the translated configuration and test thoroughly to ensure it behaves as expected.',
      alternativeApproach: 'Consider simplifying the configuration or using more portable alternatives.',
      impact: 'The translated rule may behave differently than the original.',
      docsUrl: `${this.DOCS_BASE_URL}/migration/lossy-conversions`,
    }
  }

  /**
   * Create a warning for syntax limitations
   */
  public static createSyntaxLimitationWarning(
    feature: string,
    limitation: string,
    rule?: string,
    field?: string,
  ): TranslationWarning {
    return {
      rule,
      field,
      category: 'syntax_limitation',
      message: `${feature} has syntax limitations`,
      explanation: `The ${feature} syntax has been modified due to provider limitations: ${limitation}`,
      severity: 'warning',
      suggestion: 'Verify the translated syntax works correctly in the target provider.',
      alternativeApproach: 'Use simpler syntax or alternative approaches that are more widely supported.',
      impact: 'The rule may not match traffic as precisely as intended.',
      docsUrl: `${this.DOCS_BASE_URL}/migration/syntax-limitations`,
    }
  }

  /**
   * Create a warning for performance impacts
   */
  public static createPerformanceWarning(
    feature: string,
    impact: string,
    rule?: string,
    field?: string,
  ): TranslationWarning {
    return {
      rule,
      field,
      category: 'performance_impact',
      message: `${feature} may impact performance`,
      explanation: `The ${feature} configuration may have performance implications: ${impact}`,
      severity: 'info',
      suggestion: 'Monitor performance after deployment and optimize if necessary.',
      alternativeApproach: 'Consider using more efficient alternatives or breaking complex rules into simpler ones.',
      impact: 'Request processing may be slower than expected.',
      docsUrl: `${this.DOCS_BASE_URL}/migration/performance`,
    }
  }

  /**
   * Format a translation warning for display
   */
  public static formatWarning(warning: TranslationWarning): string {
    const severityIcons = {
      critical: '🚨',
      warning: '⚠️',
      info: 'ℹ️',
    }

    const icon = severityIcons[warning.severity]
    const ruleContext = warning.rule
      ? ` (Rule: ${warning.rule}${warning.field ? `, Field: ${warning.field}` : ''})`
      : ''

    let formatted = `${icon} ${warning.severity.toUpperCase()}: ${warning.message}${ruleContext}\n`
    formatted += `   ${warning.explanation}\n`

    if (warning.suggestion) {
      formatted += `   💡 Suggestion: ${warning.suggestion}\n`
    }

    if (warning.alternativeApproach) {
      formatted += `   🔄 Alternative: ${warning.alternativeApproach}\n`
    }

    if (warning.impact) {
      formatted += `   📊 Impact: ${warning.impact}\n`
    }

    if (warning.docsUrl) {
      formatted += `   📖 Documentation: ${warning.docsUrl}\n`
    }

    return formatted
  }

  /**
   * Group warnings by severity for better organization
   */
  public static groupWarningsBySeverity(warnings: TranslationWarning[]): {
    critical: TranslationWarning[]
    warning: TranslationWarning[]
    info: TranslationWarning[]
  } {
    return {
      critical: warnings.filter((w) => w.severity === 'critical'),
      warning: warnings.filter((w) => w.severity === 'warning'),
      info: warnings.filter((w) => w.severity === 'info'),
    }
  }

  /**
   * Get a summary of warnings by category and severity
   */
  public static getWarningSummary(warnings: TranslationWarning[]): {
    total: number
    bySeverity: Record<TranslationWarningSeverity, number>
    byCategory: Record<TranslationWarningCategory, number>
    hasBlockingIssues: boolean
  } {
    const bySeverity: Record<TranslationWarningSeverity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
    }

    const byCategory: Record<TranslationWarningCategory, number> = {
      feature_unsupported: 0,
      lossy_conversion: 0,
      syntax_limitation: 0,
      performance_impact: 0,
      security_consideration: 0,
      compatibility_issue: 0,
    }

    warnings.forEach((warning) => {
      bySeverity[warning.severity]++
      byCategory[warning.category]++
    })

    return {
      total: warnings.length,
      bySeverity,
      byCategory,
      hasBlockingIssues: bySeverity.critical > 0,
    }
  }
}
