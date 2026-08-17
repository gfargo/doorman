import { getConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { mockCloudflareClientPrototype, emptyCloudflareRuleset } from '../../tests/testHelpers/providerMocks'
import { handler } from '../download'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/utils/config', () => ({ getConfig: jest.fn(), saveConfig: jest.fn() }))
jest.mock('../../lib/providers/cloudflare/CloudflareClient')

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

describe('download command — Cloudflare provider (regression test for #82)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetConfig.mockResolvedValue({} as any)
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
  })

  it('lists remote rules for a dry run without crashing', async () => {
    await handler({
      provider: 'cloudflare',
      apiToken: 'cf-token',
      zoneId: '0123456789abcdef0123456789abcdef',
      dryRun: true,
      debug: false,
      ci: true,
    } as any)

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Remote Custom Rules to Download (1)'))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Dry run completed'))
  })
})
