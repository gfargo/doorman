import { getConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { VercelClient } from '../../lib/providers/vercel/VercelClient'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { mockCloudflareClientPrototype, mockVercelClientPrototype } from '../../tests/testHelpers/providerMocks'
import { getStdoutText } from '../../tests/testHelpers/loggerMock'
import { handler } from '../diff'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/utils/config', () => ({ getConfig: jest.fn() }))
jest.mock('../../lib/providers/vercel/VercelClient')
jest.mock('../../lib/providers/cloudflare/CloudflareClient')

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

describe('diff command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVercelClientPrototype(MockedVercelClient)
    mockCloudflareClientPrototype(MockedCloudflareClient)
  })

  it('reports no differences for the Vercel provider when configs match', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)

    await handler({ provider: 'vercel', token: 't', projectId: 'prj', teamId: 'team', debug: false, ci: true } as any)

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('No differences found'))
  })

  it('still outputs valid JSON when format is json and configs match (regression test for #209)', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)

    await handler({
      provider: 'vercel',
      token: 't',
      projectId: 'prj',
      teamId: 'team',
      format: 'json',
      debug: false,
      ci: true,
    } as any)

    // Previously this case never reached the format check at all — the
    // no-changes branch returned a plain sentence regardless of --format.
    expect(logger.success).not.toHaveBeenCalled()
    const stdout = getStdoutText(logger as any)
    const parsed = JSON.parse(stdout)
    expect(parsed.summary.hasChanges).toBe(false)
  })

  it('prints rule changes for the Vercel provider as JSON when format is json', async () => {
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
      token: 't',
      projectId: 'prj',
      teamId: 'team',
      format: 'json',
      debug: false,
      ci: true,
    } as any)

    const jsonCall = (logger.log as unknown as jest.Mock).mock.calls.find((call) => String(call[0]).includes('"rules"'))
    expect(jsonCall).toBeDefined()
    const parsed = JSON.parse(jsonCall![0])
    expect(parsed.rules.toAdd).toHaveLength(1)

    // Whole-stream check — the "Calculating differences..." spinner used to
    // print unconditionally ahead of this, on the same stdout stream.
    const stdout = getStdoutText(logger as any)
    expect(() => JSON.parse(stdout)).not.toThrow()
  })

  it('reports differences for the Cloudflare provider without crashing (regression test for #82)', async () => {
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
      provider: 'cloudflare',
      apiToken: 'cf-token',
      zoneId: '0123456789abcdef0123456789abcdef',
      debug: false,
      ci: true,
    } as any)

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('cloudflare Configuration Differences'))
    const summaryCall = (logger.log as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('Summary:'),
    )
    expect(summaryCall).toBeDefined()
    expect(String(summaryCall![0])).toContain('1 total changes detected')
  })
})
