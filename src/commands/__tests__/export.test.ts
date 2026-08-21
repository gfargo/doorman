import { getConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { VercelClient } from '../../lib/providers/vercel/VercelClient'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { mockCloudflareClientPrototype, mockVercelClientPrototype } from '../../tests/testHelpers/providerMocks'
import { getStdoutText } from '../../tests/testHelpers/loggerMock'
import { handler } from '../export'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/utils/config', () => ({ getConfig: jest.fn() }))
jest.mock('../../lib/providers/vercel/VercelClient')
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
    jest.restoreAllMocks()
  })

  it('exports the local config as JSON to stdout', async () => {
    mockedGetConfig.mockResolvedValue(localVercelConfig as any)

    await handler({ source: 'local', format: 'json', output: '-', debug: false, ci: true } as any)

    const logged = (logger.log as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(JSON.parse(logged)).toEqual(localVercelConfig)
  })

  it('writes nothing but the payload to stdout for any format when no --output is given (regression test for #209)', async () => {
    mockedGetConfig.mockResolvedValue(localVercelConfig as any)

    // Whole-stream check across every logger method — the "Exporting
    // configuration in ... format..." spinner used to print unconditionally
    // on stdout ahead of the payload, for every format, not just json.
    await handler({ source: 'local', format: 'json', debug: false, ci: true } as any)
    expect(() => JSON.parse(getStdoutText(logger as any))).not.toThrow()

    jest.clearAllMocks()
    mockedGetConfig.mockResolvedValue(localVercelConfig as any)
    await handler({ source: 'local', format: 'markdown', debug: false, ci: true } as any)
    expect(getStdoutText(logger as any)).not.toContain('Exporting configuration')
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
    const parsed = JSON.parse(logged)
    // A remote export always fetches a clean UnifiedConfig now — the real
    // remote version lives under `metadata.version`, not the top-level
    // `version` (which is the unified format string, e.g. "2.0").
    expect(parsed.metadata.version).toBe(5)
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

  it('exports markdown for a multi-provider (Cloudflare) config too, not just Vercel', async () => {
    mockedGetConfig.mockResolvedValue({
      version: '2.0',
      provider: 'cloudflare',
      providers: { cloudflare: { zoneId: '0123456789abcdef0123456789abcdef' } },
      rules: [
        {
          name: 'Block Bad Bots',
          enabled: true,
          conditions: [{ field: 'user_agent', operator: 'contains', value: 'badbot' }],
          action: { type: 'deny' },
        },
      ],
      ips: [],
    } as any)

    await handler({ source: 'local', format: 'markdown', output: '-', debug: false, ci: true } as any)

    const logged = (logger.log as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('Block Bad Bots')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('exports terraform for a multi-provider (Cloudflare) config too', async () => {
    mockedGetConfig.mockResolvedValue({
      version: '2.0',
      provider: 'cloudflare',
      providers: { cloudflare: { zoneId: '0123456789abcdef0123456789abcdef' } },
      rules: [
        {
          name: 'Block Bad Bots',
          enabled: true,
          conditions: [{ field: 'user_agent', operator: 'contains', value: 'badbot' }],
          action: { type: 'deny' },
        },
      ],
      ips: [],
    } as any)

    await handler({ source: 'local', format: 'terraform', output: '-', debug: false, ci: true } as any)

    const logged = (logger.log as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('resource "firewall_rule" "rule_0"')
    expect(logged).toContain('Block Bad Bots')
  })
})
