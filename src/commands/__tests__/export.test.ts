import { getConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { VercelClient } from '../../lib/services/VercelClient'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { mockCloudflareClientPrototype } from '../../tests/testHelpers/providerMocks'
import { handler } from '../export'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/utils/config', () => ({ getConfig: jest.fn() }))
jest.mock('../../lib/services/VercelClient')
jest.mock('../../lib/providers/cloudflare/CloudflareClient')

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

const localVercelConfig = {
  version: 4,
  rules: [
    {
      id: 'rule_1',
      name: 'Block Admin',
      conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/admin' }] }],
      action: { mitigate: { action: 'deny' } },
      active: true,
    },
  ],
  ips: [],
}

describe('export command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any)
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue({
      version: 5,
      firewallEnabled: true,
      rules: [],
      ips: [],
      updatedAt: '2024-01-01T00:00:00Z',
    }) as any
    mockCloudflareClientPrototype(MockedCloudflareClient)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('exports the local config as JSON to stdout', async () => {
    mockedGetConfig.mockResolvedValue(localVercelConfig as any)

    await handler({ source: 'local', format: 'json', output: '-', debug: false, ci: true } as any)

    const logged = (logger.log as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(JSON.parse(logged)).toEqual(localVercelConfig)
  })

  it('exports the local config as markdown to stdout', async () => {
    mockedGetConfig.mockResolvedValue(localVercelConfig as any)

    await handler({ source: 'local', format: 'markdown', output: '-', debug: false, ci: true } as any)

    const logged = (logger.log as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('Block Admin')
  })

  it('exports the remote config for the Vercel provider', async () => {
    mockedGetConfig.mockResolvedValue({} as any)

    await handler({
      source: 'remote',
      provider: 'vercel',
      token: 't',
      projectId: 'prj',
      teamId: 'team',
      format: 'json',
      output: '-',
      debug: false,
      ci: true,
    } as any)

    const logged = (logger.log as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(JSON.parse(logged).version).toBe(5)
  })

  it('exports the remote config for the Cloudflare provider without crashing (regression test for #82)', async () => {
    mockedGetConfig.mockResolvedValue({} as any)

    await handler({
      source: 'remote',
      provider: 'cloudflare',
      apiToken: 'cf-token',
      zoneId: '0123456789abcdef0123456789abcdef',
      format: 'json',
      output: '-',
      debug: false,
      ci: true,
    } as any)

    const logged = (logger.log as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(JSON.parse(logged).provider).toBe('cloudflare')
  })

  it('refuses non-JSON export formats for a multi-provider config instead of producing garbage output', async () => {
    mockedGetConfig.mockResolvedValue({
      version: '2.0',
      provider: 'cloudflare',
      providers: { cloudflare: { zoneId: '0123456789abcdef0123456789abcdef' } },
      rules: [],
      ips: [],
    } as any)

    await handler({ source: 'local', format: 'markdown', output: '-', debug: false, ci: true } as any)

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('only supported for Vercel configurations'))
  })
})
