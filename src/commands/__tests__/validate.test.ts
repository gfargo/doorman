import { getConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { handler } from '../validate'

jest.mock('../../lib/logger', () => ({
  logger: { start: jest.fn(), log: jest.fn(), error: jest.fn(), success: jest.fn(), warn: jest.fn() },
}))

jest.mock('../../lib/utils/config', () => ({
  getConfig: jest.fn(),
}))

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

describe('validate command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with "${code}"`)
    }) as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports success for a valid legacy Vercel config', async () => {
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

    await handler({ verbose: false } as any)

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Configuration is valid'))
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('reports success for a valid multi-provider (Cloudflare) config', async () => {
    mockedGetConfig.mockResolvedValue({
      version: '2.0',
      provider: 'cloudflare',
      providers: { cloudflare: { zoneId: '0123456789abcdef0123456789abcdef' } },
      rules: [
        {
          name: 'Block Bad Bots',
          enabled: true,
          conditions: [{ field: 'user_agent', operator: 'contains', value: 'badbot' }],
          action: { type: 'block' },
        },
      ],
      ips: [],
    } as any)

    await handler({ verbose: false } as any)

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Configuration is valid'))
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('exits with an error for an invalid config', async () => {
    mockedGetConfig.mockResolvedValue({
      rules: [
        {
          name: 'Broken Rule',
          conditionGroup: [{ conditions: [] }], // empty condition group is invalid
          action: { mitigate: { action: 'deny' } },
          active: true,
        },
      ],
      ips: [],
    } as any)

    await expect(handler({ verbose: false } as any)).rejects.toThrow('process.exit called with "1"')
    expect(logger.success).not.toHaveBeenCalled()
  })

  it('includes the actual validation failure detail even without --verbose (regression test for #219)', async () => {
    mockedGetConfig.mockResolvedValue({
      rules: [
        {
          name: 'Broken Rule',
          conditionGroup: [{ conditions: [] }],
          action: { mitigate: { action: 'deny' } },
          active: true,
        },
      ],
      ips: [],
    } as any)

    await expect(handler({ verbose: false } as any)).rejects.toThrow('process.exit called with "1"')

    // Previously this was just "Configuration validation failed" with
    // nothing else — the only way to see *why* was to pass --verbose.
    const errorText = (logger.error as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(errorText).toContain('conditionGroup')
    expect(errorText).not.toBe('Configuration validation failed')
  })

  it('exits with an error when a Cloudflare config is missing required rule fields', async () => {
    mockedGetConfig.mockResolvedValue({
      provider: 'cloudflare',
      providers: { cloudflare: { zoneId: '0123456789abcdef0123456789abcdef' } },
      rules: [{ name: 'Missing Conditions', enabled: true, conditions: [], action: { type: 'block' } }],
      ips: [],
    } as any)

    await expect(handler({ verbose: false } as any)).rejects.toThrow('process.exit called with "1"')
  })
})
