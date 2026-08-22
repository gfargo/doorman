import { RuleTranslator } from '../RuleTranslator'
import { TranslationWarningSystem } from '../TranslationWarningSystem'
import type { VercelCustomRule } from '../../types/vercel'

describe('Translation Warning Integration', () => {
  describe('RuleTranslator with enhanced warnings', () => {
    it('should generate enhanced warnings for complex Vercel rules', () => {
      const complexRule: VercelCustomRule = {
        id: 'complex-rule-123',
        name: 'Complex Rule with Many Conditions',
        description: 'A rule with many conditions to test performance warnings',
        conditionGroup: [
          {
            conditions: [
              { op: 'eq', type: 'host', value: 'example.com' },
              { op: 'pre', type: 'path', value: '/api/' },
              { op: 're', type: 'user_agent', value: '.*bot.*' },
              { op: 'eq', type: 'method', value: 'POST' },
              { op: 'inc', type: 'geo_country', value: ['US', 'CA', 'GB'] },
              { op: 'eq', type: 'scheme', value: 'https' },
              { op: 'ex', type: 'header', key: 'authorization' },
              { op: 'sub', type: 'query', key: 'debug', value: 'true' },
              { op: 'eq', type: 'cookie', key: 'session', value: 'active' },
              { op: 'eq', type: 'ip_address', value: '192.168.1.1' },
              { op: 're', type: 'header', key: 'accept', value: 'application/json.*' },
            ],
          },
        ],
        action: {
          mitigate: {
            action: 'rate_limit',
            rateLimit: {
              requests: 100,
              window: '1h',
              characteristics: ['ip.src'],
              // No mitigationTimeout specified to trigger warning
            },
          },
        },
        active: true,
      }

      const result = RuleTranslator.vercelToUnified(complexRule)

      // vercelToUnified is the provider-agnostic Vercel-native -> Unified
      // step every command runs on every fetch, with no destination
      // provider in play — it no longer warns about regex syntax here (see
      // #214); that warning only makes sense once there's an actual target
      // provider to translate into, which no current call site of this
      // function has.
      expect(result.warnings).toHaveLength(1) // many conditions warning only
      expect(result.warnings.some((w) => w.category === 'syntax_limitation')).toBe(false)

      // Check for many conditions warning
      const performanceWarning = result.warnings.find((w) => w.category === 'performance_impact')
      expect(performanceWarning).toBeDefined()
      expect(performanceWarning?.message).toContain('11 conditions')
      expect(performanceWarning?.severity).toBe('info')
      expect(performanceWarning?.suggestion).toContain('splitting complex rules')
    })

    it('should format warnings consistently across different translation paths', () => {
      const warning = TranslationWarningSystem.createWarning('managed_rules', 'test-rule', 'conditions')
      const formatted = TranslationWarningSystem.formatWarning(warning)

      expect(formatted).toContain('🚨 CRITICAL: managed rules translation issue (Rule: test-rule, Field: conditions)')
      expect(formatted).toContain('Managed rules are provider-specific security rules')
      expect(formatted).toContain('💡 Suggestion: Replace with custom rules')
      expect(formatted).toContain('🔄 Alternative: Create custom rules')
      expect(formatted).toContain('📊 Impact: Security coverage may be reduced')
      expect(formatted).toContain('📖 Documentation:')
    })

    it('should provide warning summaries for multiple warnings', () => {
      const warnings = [
        TranslationWarningSystem.createWarning('managed_rules'), // critical
        TranslationWarningSystem.createWarning('bot_management'), // critical
        TranslationWarningSystem.createWarning('complex_expressions'), // warning
        TranslationWarningSystem.createWarning('rate_limiting_precision'), // info
        TranslationWarningSystem.createWarning('large_ip_lists'), // info
      ]

      const summary = TranslationWarningSystem.getWarningSummary(warnings)

      expect(summary.total).toBe(5)
      expect(summary.bySeverity.critical).toBe(2) // managed_rules, bot_management
      expect(summary.bySeverity.warning).toBe(1) // complex_expressions
      expect(summary.bySeverity.info).toBe(2) // rate_limiting_precision, large_ip_lists
      expect(summary.hasBlockingIssues).toBe(true)
      expect(summary.byCategory.feature_unsupported).toBe(2) // managed_rules, bot_management
      expect(summary.byCategory.lossy_conversion).toBe(2) // complex_expressions, rate_limiting_precision
      expect(summary.byCategory.performance_impact).toBe(1) // large_ip_lists
    })

    it('should group warnings by severity correctly', () => {
      const warnings = [
        TranslationWarningSystem.createWarning('managed_rules'), // critical
        TranslationWarningSystem.createWarning('complex_expressions'), // warning
        TranslationWarningSystem.createWarning('large_ip_lists'), // info
        TranslationWarningSystem.createWarning('bot_management'), // critical
      ]

      const grouped = TranslationWarningSystem.groupWarningsBySeverity(warnings)

      expect(grouped.critical).toHaveLength(2)
      expect(grouped.warning).toHaveLength(1)
      expect(grouped.info).toHaveLength(1)

      expect(grouped.critical.every((w) => w.severity === 'critical')).toBe(true)
      expect(grouped.warning.every((w) => w.severity === 'warning')).toBe(true)
      expect(grouped.info.every((w) => w.severity === 'info')).toBe(true)
    })
  })
})
