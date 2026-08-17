import { getConfig, saveConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { prompt } from '../../lib/ui/prompt'
import { handler } from '../template'

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

describe('template command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetConfig.mockResolvedValue({ rules: [], ips: [] } as any)
    mockedSaveConfig.mockResolvedValue(undefined)
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with "${code}"`)
    }) as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('appends the named template rules to the existing config and saves it', async () => {
    await handler({ name: 'wordpress', dryRun: false, debug: false } as any)

    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    const [savedConfig] = mockedSaveConfig.mock.calls[0]!
    expect((savedConfig as any).rules.length).toBeGreaterThan(0)
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining("added template 'wordpress'"))
  })

  it('does not save anything on a dry run', async () => {
    await handler({ name: 'wordpress', dryRun: true, debug: false } as any)

    expect(mockedSaveConfig).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Dry run'))
  })

  it('warns about a duplicate rule name during a dry run too, not just a real apply (regression test)', async () => {
    mockedGetConfig.mockResolvedValue({
      rules: [
        {
          name: 'Deny WordPress URLs',
          conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/wp-admin' }] }],
          action: { mitigate: { action: 'deny' } },
          active: true,
        },
      ],
      ips: [],
    } as any)

    await handler({ name: 'wordpress', dryRun: true, debug: false } as any)

    expect(mockedSaveConfig).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Deny WordPress URLs'))
  })

  it('exits with an error for an unknown template name', async () => {
    await expect(handler({ name: 'not-a-real-template', dryRun: false, debug: false } as any)).rejects.toThrow(
      'process.exit called with "1"',
    )
    expect(mockedSaveConfig).not.toHaveBeenCalled()
  })

  it('respects --config, loading and saving through the given path (regression test for #97)', async () => {
    await handler({ name: 'wordpress', config: '/custom/.doorman.json', dryRun: false, debug: false } as any)

    expect(mockedGetConfig).toHaveBeenCalledWith('/custom/.doorman.json', 'raw')
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.anything(),
      '/custom/.doorman.json',
      expect.objectContaining({ validate: false }),
    )
  })

  it('warns and cancels on a duplicate rule name when the user declines to proceed (regression test for #97)', async () => {
    mockedGetConfig.mockResolvedValue({
      rules: [
        {
          name: 'Deny WordPress URLs',
          conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/wp-admin' }] }],
          action: { mitigate: { action: 'deny' } },
          active: true,
        },
      ],
      ips: [],
    } as any)
    mockedPrompt.mockResolvedValue(false as any)

    await handler({ name: 'wordpress', dryRun: false, debug: false } as any)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Deny WordPress URLs'))
    expect(mockedSaveConfig).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('Cancelled.')
  })

  it('applies the template anyway when the user confirms past a duplicate warning', async () => {
    mockedGetConfig.mockResolvedValue({
      rules: [
        {
          name: 'Deny WordPress URLs',
          conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/wp-admin' }] }],
          action: { mitigate: { action: 'deny' } },
          active: true,
        },
      ],
      ips: [],
    } as any)
    mockedPrompt.mockResolvedValue(true as any)

    await handler({ name: 'wordpress', dryRun: false, debug: false } as any)

    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    const [savedConfig] = mockedSaveConfig.mock.calls[0]!
    // Original rule plus the duplicate-named template rule, both retained.
    expect((savedConfig as any).rules.length).toBe(2)
  })

  it('does not warn when running the template against an empty config', async () => {
    await handler({ name: 'wordpress', dryRun: false, debug: false } as any)

    expect(logger.warn).not.toHaveBeenCalled()
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
  })
})
