import { getConfig, saveConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { handler } from '../template'

jest.mock('../../lib/logger', () => ({
  logger: {
    log: jest.fn(),
    start: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('../../lib/utils/config', () => ({
  getConfig: jest.fn(),
  saveConfig: jest.fn(),
}))

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockedSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>

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

  it('exits with an error for an unknown template name', async () => {
    await expect(handler({ name: 'not-a-real-template', dryRun: false, debug: false } as any)).rejects.toThrow(
      'process.exit called with "1"',
    )
    expect(mockedSaveConfig).not.toHaveBeenCalled()
  })
})
