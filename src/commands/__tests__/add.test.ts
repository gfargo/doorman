import { getConfig, saveConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { prompt } from '../../lib/ui/prompt'
import { generateRuleId, handler } from '../add'

jest.mock('../../lib/logger', () => ({
  logger: {
    log: jest.fn(),
    start: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('../../lib/utils/config', () => ({
  getConfig: jest.fn(),
  saveConfig: jest.fn(),
}))

jest.mock('../../lib/ui/prompt', () => ({
  prompt: jest.fn(),
}))

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockedSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>
const mockedPrompt = prompt as jest.MockedFunction<typeof prompt>

const inlineRuleArgs = {
  name: 'Block Admin',
  field: 'path',
  op: 'eq',
  value: '/admin',
  action: 'deny',
  dryRun: false,
  debug: false,
}

describe('add command', () => {
  describe('handler — duplicate rule name (regression tests for #216)', () => {
    const originalIsTTY = process.stdin.isTTY

    beforeEach(() => {
      jest.clearAllMocks()
      mockedGetConfig.mockResolvedValue({
        rules: [
          {
            name: 'Block Admin',
            conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/admin' }] }],
            action: { mitigate: { action: 'deny' } },
            active: true,
          },
        ],
        ips: [],
      } as any)
      mockedSaveConfig.mockResolvedValue(undefined)
      jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit called with "${code}"`)
      }) as any)
      process.stdin.isTTY = true
    })

    afterEach(() => {
      jest.restoreAllMocks()
      process.stdin.isTTY = originalIsTTY
    })

    it('warns and cancels when the user declines to proceed on a TTY', async () => {
      mockedPrompt.mockResolvedValue(false as any)

      await handler({ ...inlineRuleArgs } as any)

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already exists'))
      expect(mockedSaveConfig).not.toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith('Cancelled.')
    })

    it('adds the rule anyway when the user confirms past the duplicate warning', async () => {
      mockedPrompt.mockResolvedValue(true as any)

      await handler({ ...inlineRuleArgs } as any)

      expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
      const [savedConfig] = mockedSaveConfig.mock.calls[0]!
      expect((savedConfig as any).rules).toHaveLength(2)
    })

    it('skips cleanly instead of prompting when stdin is not a TTY, even without --ci', async () => {
      process.stdin.isTTY = false

      await handler({ ...inlineRuleArgs } as any)

      expect(mockedPrompt).not.toHaveBeenCalled()
      expect(mockedSaveConfig).not.toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Skipping'))
    })

    it('skips cleanly instead of prompting when --ci is set, even on a TTY', async () => {
      await handler({ ...inlineRuleArgs, ci: true } as any)

      expect(mockedPrompt).not.toHaveBeenCalled()
      expect(mockedSaveConfig).not.toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Skipping'))
    })
  })

  describe('generateRuleId', () => {
    it('converts a simple name to snake_case with rule_ prefix', () => {
      expect(generateRuleId('Block Admin')).toBe('rule_block_admin')
    })

    it('handles multiple spaces and special characters', () => {
      expect(generateRuleId('Block Admin Access')).toBe('rule_block_admin_access')
    })

    it('handles names with numbers', () => {
      expect(generateRuleId('Rate Limit API v2')).toBe('rule_rate_limit_api_v2')
    })

    it('strips leading and trailing underscores', () => {
      expect(generateRuleId('  Block Admin  ')).toBe('rule_block_admin')
    })

    it('handles special characters', () => {
      expect(generateRuleId('Block (Bad) Bots!')).toBe('rule_block_bad_bots')
    })

    it('handles single word', () => {
      expect(generateRuleId('Deny')).toBe('rule_deny')
    })

    it('handles already lowercase input', () => {
      expect(generateRuleId('block admin')).toBe('rule_block_admin')
    })

    it('handles hyphens and dots', () => {
      expect(generateRuleId('block-admin.access')).toBe('rule_block_admin_access')
    })

    it('throws for names with no alphanumeric characters', () => {
      expect(() => generateRuleId('---')).toThrow('Cannot generate rule ID')
      expect(() => generateRuleId('!@#$%')).toThrow('Cannot generate rule ID')
    })
  })
})
