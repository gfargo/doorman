import { getConfig, saveConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { prompt } from '../../lib/ui/prompt'
import { VercelClient } from '../../lib/providers/vercel/VercelClient'
import { mockVercelClientPrototype } from '../../tests/testHelpers/providerMocks'
import { handler } from '../sync'

/**
 * Tests for `sync.ts`'s Vercel path now that it's migrated onto the generic
 * IFirewallProvider interface (same path as Cloudflare) — see the
 * Vercel-CLI-onto-IFirewallProvider migration plan. Supersedes the
 * characterization tests written against the legacy `services/VercelClient`
 * path in #172; several behaviors changed deliberately as part of the
 * migration (see individual test comments below).
 *
 * A confirmed sync fetches the remote Vercel config THREE times — sync.ts's
 * own pre-sync `getChanges` call (for the confirmation display),
 * `VercelFirewallService.syncRules`'s own internal `getChanges` re-diff, and
 * its post-sync re-fetch for the final version/updatedAt — so mocks below
 * queue three `fetchFirewallConfig` responses for any test that confirms.
 */

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/utils/config', () => ({ getConfig: jest.fn(), saveConfig: jest.fn() }))
jest.mock('../../lib/providers/vercel/VercelClient')
jest.mock('../../lib/ui/prompt', () => ({ prompt: jest.fn() }))

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>
const mockedSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>
const mockedPrompt = prompt as jest.MockedFunction<typeof prompt>
const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

const baseArgv = {
  config: '.doorman.json',
  provider: 'vercel' as const,
  token: 't',
  projectId: 'prj',
  teamId: 'team',
  debug: false,
  ci: false,
  allowDeletions: false,
}

const blockBadBotsRule = {
  id: 'custom-id-1',
  name: 'Block Bad Bots',
  conditionGroup: [{ conditions: [{ op: 'sub', type: 'user_agent', value: 'badbot' }] }],
  action: { mitigate: { action: 'deny' } },
  active: true,
}

function remoteConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    version: 5,
    id: 'config_1',
    firewallEnabled: true,
    crs: null,
    rules: [],
    ips: [],
    projectKey: 'pk_1',
    ownerId: 'owner_1',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('sync command (Vercel via IFirewallProvider)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with "${code}"`)
    }) as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports no changes and does nothing when local and remote are identical', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)
    mockVercelClientPrototype(MockedVercelClient, { config: remoteConfig() })

    await handler(baseArgv as any)

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('No changes detected'))
    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(mockedSaveConfig).not.toHaveBeenCalled()
    expect(MockedVercelClient.prototype.fetchFirewallConfig).toHaveBeenCalledTimes(1)
  })

  it('cancels the sync and exits non-zero when the user declines confirmation (unified with Cloudflare)', async () => {
    // Behavior change from the legacy path: declining now surfaces as a
    // hard failure (matching Cloudflare's existing confirm/cancel
    // semantics) instead of a clean "Sync cancelled." return.
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [blockBadBotsRule], ips: [] } as any)
    mockVercelClientPrototype(MockedVercelClient, { config: remoteConfig() })
    mockedPrompt.mockResolvedValue(false)

    await expect(handler(baseArgv as any)).rejects.toThrow('process.exit called with "1"')

    expect(MockedVercelClient.prototype.createFirewallRule).not.toHaveBeenCalled()
    expect(mockedSaveConfig).not.toHaveBeenCalled()
  })

  it('writes back version-only drift with no rule/IP changes', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)
    const postSync = remoteConfig({ version: 6, updatedAt: 'remote-updated-1' })
    mockVercelClientPrototype(MockedVercelClient, { config: postSync })
    mockedPrompt.mockResolvedValue(true)

    await handler(baseArgv as any)

    expect(mockedPrompt).toHaveBeenCalledTimes(1)
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ version: 6, updatedAt: 'remote-updated-1' }),
      '.doorman.json',
    )
  })

  it('writes back the provider-assigned rule ID unconditionally after create, with no separate prompt', async () => {
    // Behavior change from the legacy path: the old "guessed snake_case id"
    // reconciliation prompt is gone. The provider's actually-returned id is
    // authoritative and gets written back automatically, logged (not
    // prompted) — see VercelFirewallService.syncRules's idRemappings.
    const localRuleNoId = { ...blockBadBotsRule, id: undefined }
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [localRuleNoId], ips: [] } as any)
    mockVercelClientPrototype(MockedVercelClient, { config: remoteConfig({ version: 5 }) })
    MockedVercelClient.prototype.createFirewallRule = jest
      .fn()
      .mockResolvedValue({ ...blockBadBotsRule, id: 'server-assigned-id' })
    mockedPrompt.mockResolvedValue(true)

    await handler(baseArgv as any)

    expect(mockedPrompt).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Rule IDs were reassigned by the provider and written back'),
    )
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: [expect.objectContaining({ id: 'server-assigned-id' })],
      }),
      '.doorman.json',
    )
  })

  it('exits non-zero and does not write back when the sync reports failure', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [blockBadBotsRule], ips: [] } as any)
    mockVercelClientPrototype(MockedVercelClient, { config: remoteConfig() })
    MockedVercelClient.prototype.createFirewallRule = jest.fn().mockRejectedValue(new Error('rate limited'))
    mockedPrompt.mockResolvedValue(true)

    await expect(handler(baseArgv as any)).rejects.toThrow('process.exit called with "1"')

    expect(mockedSaveConfig).not.toHaveBeenCalled()
  })

  it('bypasses the confirmation prompt with --ci (unlike the legacy Vercel path, which always prompted)', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [blockBadBotsRule], ips: [] } as any)
    mockVercelClientPrototype(MockedVercelClient, { config: remoteConfig() })
    MockedVercelClient.prototype.createFirewallRule = jest
      .fn()
      .mockResolvedValue({ ...blockBadBotsRule, id: 'custom-id-1' })

    await handler({ ...baseArgv, ci: true } as any)

    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Firewall rules sync completed successfully'))
  })
})
