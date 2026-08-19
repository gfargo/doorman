import { getConfig, saveConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { prompt } from '../../lib/ui/prompt'
import { VercelClient } from '../../lib/services/VercelClient'
import { handler } from '../sync'

/**
 * Characterization tests for the CURRENT (pre-migration) legacy Vercel sync
 * path in sync.ts. These pin down existing behavior — including known quirks
 * — as a regression baseline before the Vercel CLI migrates onto
 * IFirewallProvider. See the migration plan for context; do not "fix" a
 * failing assertion here without updating the plan's characterization first.
 *
 * Note: a confirmed sync fetches the remote Vercel config THREE times —
 * sync.ts's own pre-sync `getChanges` call (for the confirmation display),
 * `FirewallService.syncRules`'s own internal `getChanges` re-diff, and
 * `validateAndUpdateConfig`'s post-sync verification re-fetch — so mocks
 * below queue three `fetchFirewallConfig` responses for any test that
 * confirms the initial prompt.
 */

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/utils/config', () => ({ getConfig: jest.fn(), saveConfig: jest.fn() }))
jest.mock('../../lib/services/VercelClient')
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

describe('sync command (legacy Vercel path)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with "${code}"`)
    }) as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('reports no changes and does nothing when local and remote are identical', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(remoteConfig()) as any

    await handler(baseArgv as any)

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('No changes detected'))
    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(mockedSaveConfig).not.toHaveBeenCalled()
  })

  it('does not sync anything when the user declines the initial confirmation', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [blockBadBotsRule], ips: [] } as any)
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(remoteConfig()) as any
    MockedVercelClient.prototype.createFirewallRule = jest.fn()
    mockedPrompt.mockResolvedValueOnce(false)

    await handler(baseArgv as any)

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Sync cancelled'))
    expect(MockedVercelClient.prototype.createFirewallRule).not.toHaveBeenCalled()
    expect(mockedSaveConfig).not.toHaveBeenCalled()
  })

  it('writes back version-only drift with no rule/IP changes', async () => {
    jest.useFakeTimers()
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [] } as any)
    const postSync = remoteConfig({ version: 6, updatedAt: 'remote-updated-1' })
    MockedVercelClient.prototype.fetchFirewallConfig = jest
      .fn()
      .mockResolvedValueOnce(postSync) // sync.ts's pre-sync getChanges
      .mockResolvedValueOnce(postSync) // syncRules' internal getChanges
      .mockResolvedValueOnce(postSync) // validateAndUpdateConfig's re-fetch
    mockedPrompt.mockResolvedValueOnce(true)

    const handlerPromise = handler(baseArgv as any)
    await jest.advanceTimersByTimeAsync(3000)
    await handlerPromise

    expect(mockedPrompt).toHaveBeenCalledTimes(1)
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ version: 6, updatedAt: 'remote-updated-1' }),
      '.doorman.json',
    )
  })

  it('prompts to update local rule IDs when the create leaves a guessed-id mismatch, and applies it on confirmation', async () => {
    jest.useFakeTimers()
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [blockBadBotsRule], ips: [] } as any)
    const preSync = remoteConfig({ version: 5 })
    // Post-sync verification re-fetch reports the rule back under the SAME
    // id the local config already had, which does not match
    // createFirewallRule's returned id below. This is what lets
    // FirewallService's snake_case "guessed id" survive
    // validateAndUpdateConfig's own (unrelated) content-based id remap.
    const postSync = remoteConfig({
      version: 6,
      updatedAt: 'remote-updated-2',
      rules: [{ ...blockBadBotsRule, id: 'custom-id-1' }],
    })
    MockedVercelClient.prototype.fetchFirewallConfig = jest
      .fn()
      .mockResolvedValueOnce(preSync)
      .mockResolvedValueOnce(preSync)
      .mockResolvedValueOnce(postSync)
    MockedVercelClient.prototype.createFirewallRule = jest
      .fn()
      .mockResolvedValue({ ...blockBadBotsRule, id: 'server-assigned-id' })
    mockedPrompt
      .mockResolvedValueOnce(true) // apply changes
      .mockResolvedValueOnce(true) // update local config with new IDs

    const handlerPromise = handler(baseArgv as any)
    await jest.advanceTimersByTimeAsync(3000)
    await handlerPromise

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('do not match their expected snake_case name'))
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Updated local config with new rule IDs'))

    // Written back twice: once for the ID update, once more for the
    // version/updatedAt metadata update at the end of the handler — these
    // are two independent conditions in sync.ts, not a single write.
    expect(mockedSaveConfig).toHaveBeenCalledTimes(2)
    expect(mockedSaveConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        version: 6,
        updatedAt: 'remote-updated-2',
        rules: [expect.objectContaining({ id: 'rule_block_bad_bots' })],
      }),
      '.doorman.json',
    )
  })

  it('leaves the local rule ID untouched when the user declines the ID-update prompt, but still writes back version metadata', async () => {
    jest.useFakeTimers()
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [blockBadBotsRule], ips: [] } as any)
    const preSync = remoteConfig({ version: 5 })
    const postSync = remoteConfig({
      version: 6,
      updatedAt: 'remote-updated-3',
      rules: [{ ...blockBadBotsRule, id: 'custom-id-1' }],
    })
    MockedVercelClient.prototype.fetchFirewallConfig = jest
      .fn()
      .mockResolvedValueOnce(preSync)
      .mockResolvedValueOnce(preSync)
      .mockResolvedValueOnce(postSync)
    MockedVercelClient.prototype.createFirewallRule = jest
      .fn()
      .mockResolvedValue({ ...blockBadBotsRule, id: 'server-assigned-id' })
    mockedPrompt
      .mockResolvedValueOnce(true) // apply changes
      .mockResolvedValueOnce(false) // decline updating local IDs

    const handlerPromise = handler(baseArgv as any)
    await jest.advanceTimersByTimeAsync(3000)
    await handlerPromise

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Local config not updated. Remember to update rule IDs manually'),
    )

    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 6,
        updatedAt: 'remote-updated-3',
        rules: [expect.objectContaining({ id: 'custom-id-1' })],
      }),
      '.doorman.json',
    )
  })

  it('restores the original config and exits non-zero when post-sync validation finds unexpected remote state', async () => {
    jest.useFakeTimers()
    const localIpRule = { ip: '1.2.3.4', hostname: 'example.com', action: 'deny' as const }
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [], ips: [localIpRule] } as any)
    const preSync = remoteConfig({ version: 5, ips: [] })
    const postSync = remoteConfig({
      version: 6,
      ips: [{ id: 'unexpected-ip-id', ip: '9.9.9.9', hostname: 'other.com', action: 'deny' }],
    })
    MockedVercelClient.prototype.fetchFirewallConfig = jest
      .fn()
      .mockResolvedValueOnce(preSync)
      .mockResolvedValueOnce(preSync)
      .mockResolvedValueOnce(postSync)
    MockedVercelClient.prototype.createIPBlockingRule = jest
      .fn()
      .mockResolvedValue({ ...localIpRule, id: 'ip-created-id' })
    mockedPrompt.mockResolvedValueOnce(true) // apply changes

    const handlerPromise = handler(baseArgv as any)
    // Attach the rejection expectation before advancing fake timers so the
    // rejection that fires during advanceTimersByTimeAsync is never
    // observed as unhandled. It's awaited below, just not at this call site.
    // eslint-disable-next-line jest/valid-expect
    const expectation = expect(handlerPromise).rejects.toThrow('process.exit called with "1"')
    await jest.advanceTimersByTimeAsync(3000)
    await expectation

    expect(logger.error).toHaveBeenCalledWith('Failed to validate sync result or update config metadata')
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Restored original config'))
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    expect(mockedSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ version: 5, rules: [], ips: [localIpRule] }),
      '.doorman.json',
    )
  })

  it('still prompts interactively for Vercel sync even when --ci is set (no CI bypass in the legacy path)', async () => {
    mockedGetConfig.mockResolvedValue({ version: 5, rules: [blockBadBotsRule], ips: [] } as any)
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(remoteConfig()) as any
    mockedPrompt.mockResolvedValueOnce(false)

    await handler({ ...baseArgv, ci: true } as any)

    expect(mockedPrompt).toHaveBeenCalledWith('Do you want to apply these changes?', { type: 'confirm' })
  })
})
