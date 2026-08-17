import { getConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { VercelClient } from '../../lib/services/VercelClient'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { mockCloudflareClientPrototype } from '../../tests/testHelpers/providerMocks'
import { handler } from '../status'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))

jest.mock('../../lib/utils/config', () => ({
  getConfig: jest.fn(),
}))

jest.mock('../../lib/services/VercelClient')
jest.mock('../../lib/providers/cloudflare/CloudflareClient')

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

const vercelRemoteConfig = {
  version: 5,
  firewallEnabled: true,
  rules: [],
  ips: [],
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('status command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(vercelRemoteConfig) as any
    mockCloudflareClientPrototype(MockedCloudflareClient)
  })

  it('reports in-sync status for the Vercel provider when local matches remote', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)

    await handler({
      provider: 'vercel',
      token: 'test-token',
      projectId: 'prj_test',
      teamId: 'team_test',
      debug: false,
      ci: true,
    } as any)

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Everything is in sync'))
  })

  it('reports changes detected for the Vercel provider when local differs from remote', async () => {
    mockedGetConfig.mockResolvedValue({
      version: 3,
      rules: [
        {
          name: 'New Rule',
          conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/new' }] }],
          action: { mitigate: { action: 'deny' } },
          active: true,
        },
      ],
      ips: [],
    } as any)

    await handler({
      provider: 'vercel',
      token: 'test-token',
      projectId: 'prj_test',
      teamId: 'team_test',
      debug: false,
      ci: true,
    } as any)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Changes detected'))
  })

  it('reports status for the Cloudflare provider without crashing (regression test for #82)', async () => {
    mockedGetConfig.mockResolvedValue({
      version: '2.0',
      provider: 'cloudflare',
      providers: { cloudflare: { zoneId: '0123456789abcdef0123456789abcdef' } },
      rules: [],
      ips: [],
    } as any)

    await handler({
      provider: 'cloudflare',
      apiToken: 'test-cf-token',
      zoneId: '0123456789abcdef0123456789abcdef',
      debug: false,
      ci: true,
    } as any)

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('cloudflare Sync Status Summary'))
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Everything is in sync'))
  })
})
