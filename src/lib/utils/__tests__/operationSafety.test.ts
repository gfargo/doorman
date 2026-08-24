import { OperationSafety } from '../operationSafety'
import type { UnifiedConfig, UnifiedManagedRuleGroup } from '../../types/unified'
import type { ChangeSet } from '../../providers/IFirewallProvider'

// Mock the logger
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// Mock the prompt
jest.mock('../../ui/prompt', () => ({
  prompt: jest.fn(),
}))

describe('OperationSafety', () => {
  const mockConfig: UnifiedConfig = {
    version: '2.0',
    provider: 'cloudflare',
    rules: [
      {
        id: 'rule_test',
        name: 'Test Rule',
        description: 'Test rule description',
        enabled: true,
        action: {
          type: 'deny',
        },
        conditions: [
          {
            field: 'path',
            operator: 'eq',
            value: '/test',
          },
        ],
      },
    ],
    ips: [
      {
        id: 'ip_test',
        ip: '192.168.1.1',
        action: 'deny',
      },
    ],
  }

  const mockChanges: ChangeSet = {
    rulesToAdd: [],
    rulesToUpdate: [],
    rulesToDelete: [],
    ipsToAdd: [],
    ipsToUpdate: [],
    ipsToDelete: [],
    hasChanges: false,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('performDryRunValidation', () => {
    it('should validate configuration structure', async () => {
      const validateFn = jest.fn().mockResolvedValue(mockChanges)

      const result = await OperationSafety.performDryRunValidation(mockConfig, 'test operation', validateFn)

      expect(result.valid).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(validateFn).toHaveBeenCalledWith(mockConfig)
    })

    it('should detect configuration issues', async () => {
      const invalidConfig = {
        ...mockConfig,
        version: undefined,
        provider: undefined,
      } as any

      const validateFn = jest.fn().mockResolvedValue(mockChanges)

      const result = await OperationSafety.performDryRunValidation(invalidConfig, 'test operation', validateFn)

      expect(result.valid).toBe(false)
      expect(result.issues.length).toBeGreaterThan(0)
      expect(result.issues).toContain('Configuration missing version field')
      expect(result.issues).toContain('Configuration missing provider field')
    })

    it('should handle validation function errors', async () => {
      const validateFn = jest.fn().mockRejectedValue(new Error('Validation failed'))

      const result = await OperationSafety.performDryRunValidation(mockConfig, 'test operation', validateFn)

      expect(result.valid).toBe(false)
      expect(result.issues).toContain('Dry-run validation failed: Validation failed')
    })

    it('should surface duplicate rule names as a warning, not a blocking issue', async () => {
      const configWithDuplicates: UnifiedConfig = {
        ...mockConfig,
        rules: [
          { ...mockConfig.rules[0]!, id: 'rule_1', name: 'Block Bad Bots' },
          { ...mockConfig.rules[0]!, id: 'rule_2', name: 'Block Bad Bots' },
        ],
      }
      const validateFn = jest.fn().mockResolvedValue(mockChanges)

      const result = await OperationSafety.performDryRunValidation(configWithDuplicates, 'test operation', validateFn)

      expect(result.valid).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(result.warnings.some((w) => w.includes('Duplicate rule names found'))).toBe(true)
    })

    it('should surface a high deletion ratio as a warning, not a blocking issue', async () => {
      const deletionHeavyChanges: ChangeSet = {
        rulesToAdd: [],
        rulesToUpdate: [],
        rulesToDelete: [mockConfig.rules[0]!],
        ipsToAdd: [],
        ipsToUpdate: [],
        ipsToDelete: [],
        hasChanges: true,
      }
      const validateFn = jest.fn().mockResolvedValue(deletionHeavyChanges)

      const result = await OperationSafety.performDryRunValidation(mockConfig, 'test operation', validateFn)

      expect(result.valid).toBe(true)
      expect(result.issues).toHaveLength(0)
      expect(result.warnings.some((w) => w.includes('High deletion ratio detected'))).toBe(true)
    })
  })

  describe('assessOperationRisk', () => {
    // Shared across Vercel and Cloudflare (see #104) — this is the one place
    // both providers' dry-run/confirmation safety checks actually branch on,
    // so its classification logic needs direct coverage rather than only
    // being exercised indirectly through mocked confirmDestructiveOperation
    // calls in the provider-level test suites.
    const configWithRules = (ruleCount: number, ipCount = 0): UnifiedConfig => ({
      version: '2.0',
      provider: 'cloudflare',
      rules: Array.from({ length: ruleCount }, (_, i) => ({
        id: `rule_${i}`,
        name: `Rule ${i}`,
        enabled: true,
        action: { type: 'log' },
        conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
      })),
      ips: Array.from({ length: ipCount }, (_, i) => ({
        id: `ip_${i}`,
        ip: `10.0.0.${i}`,
        action: 'deny',
      })),
    })

    const changesWith = (overrides: Partial<ChangeSet>): ChangeSet => ({
      rulesToAdd: [],
      rulesToUpdate: [],
      rulesToDelete: [],
      ipsToAdd: [],
      ipsToUpdate: [],
      ipsToDelete: [],
      hasChanges: true,
      ...overrides,
    })

    it('is low risk for additions only', () => {
      const changes = changesWith({ rulesToAdd: [{}] as UnifiedConfig['rules'] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(0))).toBe('low')
    })

    it('is high risk when deleting every existing rule', () => {
      const changes = changesWith({ rulesToDelete: [{}, {}] as UnifiedConfig['rules'] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(2))).toBe('high')
    })

    it('is high risk when deleting more than half of existing rules/IPs', () => {
      // 6 deletions out of 10 existing (rules + ips) = 60% > 50%, but not "all"
      const changes = changesWith({ rulesToDelete: Array.from({ length: 6 }, () => ({})) as UnifiedConfig['rules'] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(8, 2))).toBe('high')
    })

    it('is high risk when the total change count exceeds 50', () => {
      const changes = changesWith({ rulesToAdd: Array.from({ length: 51 }, () => ({})) as UnifiedConfig['rules'] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(0))).toBe('high')
    })

    it('is high risk for a deny rule matching all traffic on path "/"', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'r1',
            name: 'Block everything',
            enabled: true,
            action: { type: 'deny' },
            conditions: [{ field: 'path', operator: 'eq', value: '/' }],
          },
        ],
        ips: [],
      }
      const changes = changesWith({ rulesToAdd: [{}] as UnifiedConfig['rules'] })
      expect(OperationSafety.assessOperationRisk(changes, config)).toBe('high')
    })

    it('is medium risk for any deletion below the high-risk thresholds', () => {
      const changes = changesWith({ rulesToDelete: [{}] as UnifiedConfig['rules'] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(10))).toBe('medium')
    })

    it('is medium risk when the total change count exceeds 10 but not 50', () => {
      const changes = changesWith({ rulesToAdd: Array.from({ length: 11 }, () => ({})) as UnifiedConfig['rules'] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(0))).toBe('medium')
    })

    it('is medium risk for rule updates', () => {
      const changes = changesWith({ rulesToUpdate: [{}] as UnifiedConfig['rules'] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(5))).toBe('medium')
    })

    // #183 — managed rule groups must feed the same risk signals rules/ips
    // already do; a config that only touches managedRules shouldn't be
    // silently classified as 'low' risk just because assessOperationRisk
    // never looked at those fields.
    it('is medium risk for managed rule group updates', () => {
      const changes = changesWith({ managedRulesToUpdate: [{}] as UnifiedManagedRuleGroup[] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(0))).toBe('medium')
    })

    it('is high risk when the total change count exceeds 50, counting managed rule group additions', () => {
      const changes = changesWith({
        managedRulesToAdd: Array.from({ length: 51 }, () => ({})) as UnifiedManagedRuleGroup[],
      })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(0))).toBe('high')
    })

    it('is medium risk for a managed rule group deletion alone (deletion gate is not rules/ips-only)', () => {
      const changes = changesWith({ managedRulesToDelete: [{}] as UnifiedManagedRuleGroup[] })
      expect(OperationSafety.assessOperationRisk(changes, configWithRules(10))).toBe('medium')
    })
  })

  describe('confirmDestructiveOperation', () => {
    // Regression coverage for the CI-deletion safety gate: `skipConfirmation`
    // (--force/--ci) authorizes running non-interactively, but must never by
    // itself authorize deleting rules — see the comment in operationSafety.ts.
    const changesWithDeletions: ChangeSet = {
      rulesToAdd: [],
      rulesToUpdate: [],
      rulesToDelete: [{}] as UnifiedConfig['rules'],
      ipsToAdd: [],
      ipsToUpdate: [],
      ipsToDelete: [],
      hasChanges: true,
    }

    const changesWithoutDeletions: ChangeSet = {
      rulesToAdd: [{}] as UnifiedConfig['rules'],
      rulesToUpdate: [],
      rulesToDelete: [],
      ipsToAdd: [],
      ipsToUpdate: [],
      ipsToDelete: [],
      hasChanges: true,
    }

    it('refuses a non-interactive operation that would delete rules without allowDeletions', async () => {
      const confirmed = await OperationSafety.confirmDestructiveOperation({
        operation: 'sync rules',
        target: 'Cloudflare zone test',
        changes: changesWithDeletions,
        riskLevel: 'high',
        skipConfirmation: true,
      })

      expect(confirmed).toBe(false)
    })

    it('allows a non-interactive operation that would delete rules when allowDeletions is set', async () => {
      const confirmed = await OperationSafety.confirmDestructiveOperation({
        operation: 'sync rules',
        target: 'Cloudflare zone test',
        changes: changesWithDeletions,
        riskLevel: 'high',
        skipConfirmation: true,
        allowDeletions: true,
      })

      expect(confirmed).toBe(true)
    })

    it('allows a non-interactive operation with no deletions without needing allowDeletions', async () => {
      const confirmed = await OperationSafety.confirmDestructiveOperation({
        operation: 'sync rules',
        target: 'Cloudflare zone test',
        changes: changesWithoutDeletions,
        riskLevel: 'low',
        skipConfirmation: true,
      })

      expect(confirmed).toBe(true)
    })

    it('short-circuits true for dry runs regardless of deletions or allowDeletions', async () => {
      const confirmed = await OperationSafety.confirmDestructiveOperation({
        operation: 'sync rules',
        target: 'Cloudflare zone test',
        changes: changesWithDeletions,
        riskLevel: 'high',
        dryRun: true,
      })

      expect(confirmed).toBe(true)
    })

    // #183 — the deletion gate must count managed rule group deletions too,
    // not just rules/ips, or a config that only removes a managed ruleset
    // could slip through a non-interactive --force/--ci run unconfirmed.
    it('refuses a non-interactive operation that would delete managed rule groups without allowDeletions', async () => {
      const changesWithManagedRuleDeletions: ChangeSet = {
        rulesToAdd: [],
        rulesToUpdate: [],
        rulesToDelete: [],
        ipsToAdd: [],
        ipsToUpdate: [],
        ipsToDelete: [],
        managedRulesToDelete: [{}] as UnifiedManagedRuleGroup[],
        hasChanges: true,
      }

      const confirmed = await OperationSafety.confirmDestructiveOperation({
        operation: 'sync rules',
        target: 'Cloudflare zone test',
        changes: changesWithManagedRuleDeletions,
        riskLevel: 'high',
        skipConfirmation: true,
      })

      expect(confirmed).toBe(false)
    })
  })

  describe('getBackupRecommendation', () => {
    it('should recommend backup for high-risk operations', () => {
      const recommendation = OperationSafety.getBackupRecommendation('delete ruleset', 'high')

      expect(recommendation.recommended).toBe(true)
      expect(recommendation.reason).toContain('irreversible')
      expect(recommendation.instructions.length).toBeGreaterThan(0)
    })

    it('should not recommend backup for low-risk operations', () => {
      const recommendation = OperationSafety.getBackupRecommendation('update rules', 'low')

      expect(recommendation.recommended).toBe(false)
    })
  })

  describe('getRollbackGuidance', () => {
    it('should provide rollback guidance for sync operations', () => {
      const guidance = OperationSafety.getRollbackGuidance('sync rules')

      expect(guidance.available).toBe(true)
      expect(guidance.method).toContain('backup')
      expect(guidance.instructions.length).toBeGreaterThan(0)
    })

    it('should indicate when rollback is not available', () => {
      const guidance = OperationSafety.getRollbackGuidance('delete ruleset')

      expect(guidance.available).toBe(false)
      expect(guidance.method).toContain('Recreation required')
    })
  })
})
