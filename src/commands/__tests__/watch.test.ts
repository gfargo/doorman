import type { Stats } from 'fs'
import { getConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { VercelClient } from '../../lib/providers/vercel/VercelClient'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { mockCloudflareClientPrototype, mockVercelClientPrototype } from '../../tests/testHelpers/providerMocks'
import { handler } from '../watch'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/utils/config', () => ({ getConfig: jest.fn(), saveConfig: jest.fn() }))
jest.mock('../../lib/providers/vercel/VercelClient')
jest.mock('../../lib/providers/cloudflare/CloudflareClient')

let capturedWatchListener: ((curr: Stats, prev: Stats) => void) | undefined

jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    watchFile: jest.fn((_path: string, _opts: unknown, listener: (curr: Stats, prev: Stats) => void) => {
      capturedWatchListener = listener
    }),
    unwatchFile: jest.fn(),
  }
})

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

function fakeStats(mtimeMs: number): Stats {
  return { mtime: new Date(mtimeMs) } as Stats
}

describe('watch command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    capturedWatchListener = undefined
    mockVercelClientPrototype(MockedVercelClient, {
      config: {
        version: 5,
        id: 'config_1',
        firewallEnabled: true,
        crs: null,
        rules: [],
        ips: [],
        projectKey: 'pk_1',
        ownerId: 'owner_1',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    })
    mockCloudflareClientPrototype(MockedCloudflareClient)
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('registers a file watcher and does nothing until the file changes', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)

    await handler({
      config: '.doorman.json',
      provider: 'vercel',
      token: 't',
      projectId: 'prj',
      teamId: 'team',
      interval: 50,
      debug: false,
      ci: true,
    } as any)

    expect(capturedWatchListener).toBeDefined()
  })

  it('syncs via the Cloudflare provider on file change without crashing (regression test for #82)', async () => {
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

    await handler({
      config: '.doorman.json',
      provider: 'cloudflare',
      apiToken: 'cf-token',
      zoneId: '0123456789abcdef0123456789abcdef',
      interval: 50,
      debug: false,
      ci: true,
    } as any)

    expect(capturedWatchListener).toBeDefined()
    await capturedWatchListener!(fakeStats(2000), fakeStats(1000))

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Sync completed'))
  })

  it('surfaces sync warnings from the Cloudflare provider instead of silently dropping them', async () => {
    mockedGetConfig.mockResolvedValue({
      version: '2.0',
      provider: 'cloudflare',
      providers: { cloudflare: { zoneId: '0123456789abcdef0123456789abcdef' } },
      rules: [
        {
          name: 'Duplicate Rule',
          enabled: true,
          conditions: [{ field: 'user_agent', operator: 'contains', value: 'badbot' }],
          action: { type: 'block' },
        },
        {
          name: 'Duplicate Rule',
          enabled: true,
          conditions: [{ field: 'path', operator: 'eq', value: '/admin' }],
          action: { type: 'block' },
        },
      ],
      ips: [],
    } as any)

    await handler({
      config: '.doorman.json',
      provider: 'cloudflare',
      apiToken: 'cf-token',
      zoneId: '0123456789abcdef0123456789abcdef',
      interval: 50,
      debug: false,
      ci: true,
    } as any)

    await capturedWatchListener!(fakeStats(2000), fakeStats(1000))

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate rule names found'))
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Sync completed'))
  })

  it('skips syncing when the file change reports no config differences', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)

    await handler({
      config: '.doorman.json',
      provider: 'vercel',
      token: 't',
      projectId: 'prj',
      teamId: 'team',
      interval: 50,
      debug: false,
      ci: true,
    } as any)

    await capturedWatchListener!(fakeStats(2000), fakeStats(1000))

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No changes detected'))
  })
})
