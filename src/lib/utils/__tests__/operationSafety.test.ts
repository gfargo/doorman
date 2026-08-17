import { OperationSafety } from '../operationSafety'
import type { UnifiedConfig } from '../../types/unified'
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
