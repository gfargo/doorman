import { getConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { VercelClient } from '../../lib/providers/vercel/VercelClient'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { mockCloudflareClientPrototype, mockVercelClientPrototype } from '../../tests/testHelpers/providerMocks'
import { getStdoutText } from '../../tests/testHelpers/loggerMock'
import { handler } from '../status'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))

jest.mock('../../lib/utils/config', () => ({
  getConfig: jest.fn(),
}))

jest.mock('../../lib/providers/vercel/VercelClient')
jest.mock('../../lib/providers/cloudflare/CloudflareClient')

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

const vercelRemoteConfig = {
  version: 5,
  id: 'config_1',
  firewallEnabled: true,
  crs: null,
  rules: [],
  ips: [],
  projectKey: 'pk_1',
  ownerId: 'owner_1',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('status command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVercelClientPrototype(MockedVercelClient, { config: vercelRemoteConfig })
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

  it('outputs valid JSON on stdout when format is json and configs match (#210)', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)

    await handler({
      provider: 'vercel',
      token: 'test-token',
      projectId: 'prj_test',
      teamId: 'team_test',
      format: 'json',
      debug: false,
      ci: true,
    } as any)

    // Whole-stream check (see getStdoutText docstring) — this is the same
    // shape of bug fixed for list/diff/export in #209: a command that prints
    // progress chrome ahead of --format json output on the same stdout
    // stream.
    const stdout = getStdoutText(logger as any)
    const parsed = JSON.parse(stdout)
    expect(parsed.inSync).toBe(true)
    expect(parsed.health.score).toEqual(expect.any(Number))
  })

  it('reflects drift in JSON output when local differs from remote (#210)', async () => {
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
      format: 'json',
      debug: false,
      ci: true,
    } as any)

    const parsed = JSON.parse(getStdoutText(logger as any))
    expect(parsed.inSync).toBe(false)
    expect(parsed.rules.toAdd).toBe(1)
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
