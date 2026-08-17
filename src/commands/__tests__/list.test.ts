import { VercelClient } from '../../lib/services/VercelClient'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { logger } from '../../lib/logger'
import { mockCloudflareClientPrototype, emptyCloudflareRuleset } from '../../tests/testHelpers/providerMocks'
import { handler } from '../list'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/services/VercelClient')
jest.mock('../../lib/providers/cloudflare/CloudflareClient')

const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

const vercelRemoteConfig = {
  version: 5,
  firewallEnabled: true,
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
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('list command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(vercelRemoteConfig) as any
    mockCloudflareClientPrototype(MockedCloudflareClient)
  })

  it('lists rules for the Vercel provider', async () => {
    await handler({
      provider: 'vercel',
      token: 't',
      projectId: 'prj',
      teamId: 'team',
      format: 'table',
      debug: false,
      ci: true,
    } as any)

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found'))
  })

  it('outputs JSON for the Vercel provider when format is json', async () => {
    await handler({
      provider: 'vercel',
      token: 't',
      projectId: 'prj',
      teamId: 'team',
      format: 'json',
      debug: false,
      ci: true,
    } as any)

    const jsonCall = (logger.info as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('"rules"'),
    )
    expect(jsonCall).toBeDefined()
    const parsed = JSON.parse(jsonCall![0])
    expect(parsed.rules).toHaveLength(1)
  })

  it('lists rules for the Cloudflare provider without crashing (regression test for #82)', async () => {
    mockCloudflareClientPrototype(MockedCloudflareClient, {
      ruleset: emptyCloudflareRuleset({
        rules: [
          {
            id: 'r1',
            action: 'block',
            expression: 'http.request.uri.path eq "/admin"',
            description: 'Block Admin',
            enabled: true,
          },
        ],
      }),
    })

    await handler({
      provider: 'cloudflare',
      apiToken: 'cf-token',
      zoneId: '0123456789abcdef0123456789abcdef',
      format: 'table',
      debug: false,
      ci: true,
    } as any)

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found'))
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Custom Rules:'), '\n')
  })
})
