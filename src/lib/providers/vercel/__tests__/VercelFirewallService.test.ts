import { VercelFirewallService } from '../VercelFirewallService'
import { VercelClient } from '../VercelClient'
import type { UnifiedConfig } from '../../../types/unified'

// Mock the logger
jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// Mock the prompt module — used to assert the create-firewall-config prompt
// is never triggered during a dry run (regression coverage, see below).
jest.mock('../../../ui/prompt', () => ({
  prompt: jest.fn(),
}))

import { OperationSafety } from '../../../utils/operationSafety'
import { prompt } from '../../../ui/prompt'

describe('VercelFirewallService', () => {
  let service: VercelFirewallService
  let client: VercelClient

  const mockVercelConfig = {
    version: 1,
    id: 'config_1',
    firewallEnabled: true,
    crs: {},
    rules: [
      {
        id: 'rule_1',
        name: 'Block bots',
        description: 'Block bad bots',
        active: true,
        conditionGroup: [
          {
            conditions: [{ type: 'user_agent' as const, op: 'sub' as const, value: 'BadBot' }],
          },
        ],
        action: {
          mitigate: {
            action: 'deny' as const,
            rateLimit: null,
            redirect: null,
            actionDuration: null,
          },
        },
      },
    ],
    ips: [
      {
        id: 'ip_1',
        ip: '1.2.3.4',
        hostname: 'example.com',
        action: 'deny' as const,
        notes: 'Blocked IP',
      },
    ],
    projectKey: 'pk_123',
    ownerId: 'owner_1',
    updatedAt: '2024-01-01T00:00:00Z',
  }

  beforeEach(() => {
    client = new VercelClient('proj_123', 'team_456', 'test-token')
    service = new VercelFirewallService(client)
    jest.clearAllMocks()
    // Auto-approve the destructive-operation confirmation prompt syncRules
    // now performs (regression coverage for #104) — dry-run validation and
    // risk assessment stay real so computed changes still flow through to
    // the sync assertions below.
    jest.spyOn(OperationSafety, 'confirmDestructiveOperation').mockResolvedValue(true)
  })

  describe('name', () => {
    it('should be "vercel"', () => {
      expect(service.name).toBe('vercel')
    })
  })

  describe('fetchConfig', () => {
    it('should fetch and convert to UnifiedConfig', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await service.fetchConfig()

      expect(result.version).toBe('2.0')
      expect(result.provider).toBe('vercel')
      expect(result.rules).toHaveLength(1)
      expect(result.rules[0]!.name).toBe('Block bots')
      expect(result.rules[0]!.enabled).toBe(true)
    })

    it('should convert IP rules to unified format', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await service.fetchConfig()

      expect(result.ips).toHaveLength(1)
      expect(result.ips![0]!.ip).toBe('1.2.3.4')
      expect(result.ips![0]!.action).toBe('deny')
    })

    it('should include metadata', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await service.fetchConfig()

      expect(result.metadata).toBeDefined()
      expect(result.metadata!.version).toBe(1)
      expect(result.metadata!.updatedAt).toBe('2024-01-01T00:00:00Z')
    })

    // Regression test: fetchConfig previously set `provider: 'vercel'` with
    // no matching `providers.vercel` block — CloudflareFirewallService
    // already sets `providers.cloudflare` alongside `provider: 'cloudflare'`.
    // Without it, anything running the result through ValidationService
    // (e.g. `backup`'s config validation, `saveConfig`'s default validation)
    // throws "Provider 'vercel' specified but no configuration found in
    // providers section", and ProviderDetector's round-trip auto-detection
    // (which looks for providers.vercel.projectId) silently breaks.
    it('should set providers.vercel alongside provider', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await service.fetchConfig()

      expect(result.providers?.vercel).toEqual({ projectId: 'proj_123', teamId: 'team_456' })
    })

    // Regression test for #207: a client with no teamId (every Vercel
    // account has a default team, so this is a normal, supported case) must
    // omit the key entirely from providers.vercel rather than setting it to
    // `undefined` — an unconditionally-set optional key is exactly the
    // isDeepEqual/diffing pitfall documented in #199/#203.
    it('omits teamId from providers.vercel when the client has none', async () => {
      const clientWithoutTeam = new VercelClient('proj_123', undefined, 'test-token')
      const serviceWithoutTeam = new VercelFirewallService(clientWithoutTeam)
      jest.spyOn(clientWithoutTeam, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await serviceWithoutTeam.fetchConfig()

      expect(result.providers?.vercel).toEqual({ projectId: 'proj_123' })
      expect(result.providers?.vercel).not.toHaveProperty('teamId')
    })

    it('should pass version parameter to client', async () => {
      const spy = jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      await service.fetchConfig(5)

      expect(spy).toHaveBeenCalledWith(5)
    })

    it('should throw on error', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockRejectedValue(new Error('API error'))

      await expect(service.fetchConfig()).rejects.toThrow('Failed to fetch Vercel firewall configuration')
    })
  })

  describe('syncRules', () => {
    const unifiedConfig: UnifiedConfig = {
      version: '2.0',
      provider: 'vercel',
      rules: [
        {
          id: 'rule_1',
          name: 'Block bots',
          description: 'Block bad bots',
          enabled: true,
          conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot' }],
          action: { type: 'deny' },
        },
      ],
      ips: [{ id: 'ip_1', ip: '1.2.3.4', hostname: 'example.com', action: 'deny', notes: 'Blocked' }],
    }

    it('should return dry run result without making changes', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await service.syncRules(unifiedConfig, { dryRun: true })

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(0)
      expect(result.rulesUpdated).toBe(0)
      expect(result.rulesDeleted).toBe(0)
      expect(result.ipsAdded).toBe(0)
      expect(result.ipsUpdated).toBe(0)
      expect(result.ipsDeleted).toBe(0)
    })

    it('should sync rules and return counts', async () => {
      // First call for getChanges, second for final version
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [],
        ips: [],
      })
      jest.spyOn(client, 'createFirewallRule').mockResolvedValue({
        id: 'new_rule_1',
        name: 'Block bots',
        active: true,
        conditionGroup: [],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
      })
      jest.spyOn(client, 'createIPBlockingRule').mockResolvedValue({
        id: 'new_ip_1',
        ip: '1.2.3.4',
        hostname: 'example.com',
        action: 'deny',
      })

      const result = await service.syncRules(unifiedConfig)

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
      expect(result.ipsAdded).toBe(1)
    })

    it('deletes stale rules before creating new ones', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'New Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/new' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)
      const deleteSpy = jest.spyOn(client, 'deleteFirewallRule').mockResolvedValue(undefined)
      const createSpy = jest.spyOn(client, 'createFirewallRule').mockResolvedValue({
        id: 'new_rule_1',
        name: 'New Rule',
        active: true,
        conditionGroup: [],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
      })

      const result = await service.syncRules(config)

      expect(deleteSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'rule_1' }))
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Rule' }))
      expect(deleteSpy.mock.invocationCallOrder[0]!).toBeLessThan(createSpy.mock.invocationCallOrder[0]!)
      expect(result.rulesDeleted).toBe(1)
      expect(result.rulesAdded).toBe(1)
    })

    it('asks for confirmation before applying a destructive sync, not just Cloudflare (regression test for #104)', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [],
        ips: [],
      })
      jest.spyOn(client, 'createFirewallRule').mockResolvedValue({
        id: 'new_rule_1',
        name: 'Block bots',
        active: true,
        conditionGroup: [],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
      })
      jest.spyOn(client, 'createIPBlockingRule').mockResolvedValue({
        id: 'new_ip_1',
        ip: '1.2.3.4',
        hostname: 'example.com',
        action: 'deny',
      })

      await service.syncRules(unifiedConfig)

      expect(OperationSafety.confirmDestructiveOperation).toHaveBeenCalledTimes(1)
      expect(OperationSafety.confirmDestructiveOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'sync rules', skipConfirmation: false }),
      )
    })

    it('cancels the sync without calling the API when the user declines the confirmation', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [],
        ips: [],
      })
      const createFirewallRuleSpy = jest.spyOn(client, 'createFirewallRule')
      jest.spyOn(OperationSafety, 'confirmDestructiveOperation').mockResolvedValue(false)

      await expect(service.syncRules(unifiedConfig)).rejects.toThrow('Failed to synchronize firewall rules')
      expect(createFirewallRuleSpy).not.toHaveBeenCalled()
    })

    it('skips the confirmation prompt entirely when force is set', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [],
        ips: [],
      })
      jest.spyOn(client, 'createFirewallRule').mockResolvedValue({
        id: 'new_rule_1',
        name: 'Block bots',
        active: true,
        conditionGroup: [],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
      })
      jest.spyOn(client, 'createIPBlockingRule').mockResolvedValue({
        id: 'new_ip_1',
        ip: '1.2.3.4',
        hostname: 'example.com',
        action: 'deny',
      })

      await service.syncRules(unifiedConfig, { force: true })

      expect(OperationSafety.confirmDestructiveOperation).toHaveBeenCalledWith(
        expect.objectContaining({ skipConfirmation: true }),
      )
    })

    it('should throw on error', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockRejectedValue(new Error('API error'))

      await expect(service.syncRules(unifiedConfig)).rejects.toThrow('Failed to synchronize firewall rules')
    })

    describe('dry-run side effects (regression: --dry-run must never prompt or mutate)', () => {
      it('computes changes without allowing the remote config to be auto-created during a dry run', async () => {
        const spy = jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
          ...mockVercelConfig,
          rules: [],
          ips: [],
        })

        await service.syncRules(unifiedConfig, { dryRun: true })

        expect(spy).toHaveBeenCalledWith(undefined, { allowCreate: false })
      })

      it('still allows the remote config to be auto-created for a real (non-dry-run) sync', async () => {
        const spy = jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
          ...mockVercelConfig,
          rules: [],
          ips: [],
        })
        jest.spyOn(client, 'createFirewallRule').mockResolvedValue({
          id: 'new_rule_1',
          name: 'Block bots',
          active: true,
          conditionGroup: [],
          action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
        })
        jest.spyOn(client, 'createIPBlockingRule').mockResolvedValue({
          id: 'new_ip_1',
          ip: '1.2.3.4',
          hostname: 'example.com',
          action: 'deny',
        })

        await service.syncRules(unifiedConfig)

        expect(spy).toHaveBeenCalledWith(undefined, { allowCreate: true })
      })

      it('never prompts to create a firewall config, or performs the mutating create, during a dry run against an unconfigured project (end-to-end through the real VercelClient)', async () => {
        // Uses the real VercelClient (not a stubbed fetchFirewallConfig) so this
        // exercises the fix all the way down to the HTTP layer: a project with
        // no active firewall config yet must never trigger the interactive
        // "Would you like to create one?" prompt during --dry-run, since that
        // prompt (a) hangs with no TTY in CI/non-interactive runs and (b) is
        // followed by a real mutating PUT if confirmed.
        const realClient = new VercelClient('proj_123', 'team_456', 'test-token')
        const realService = new VercelFirewallService(realClient)

        const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          json: jest.fn().mockResolvedValue({ active: null }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ active: null })),
          clone: jest.fn(),
        } as unknown as Response)
        const putEmptyConfigSpy = jest.spyOn(realClient, 'putEmptyConfig')

        const result = await realService.syncRules(unifiedConfig, { dryRun: true })

        expect(prompt).not.toHaveBeenCalled()
        expect(putEmptyConfigSpy).not.toHaveBeenCalled()
        expect(result.success).toBe(true)

        fetchSpy.mockRestore()
      })
    })

    describe('partial failure handling (regression: a single failing operation used to abort the whole sync and discard the real error)', () => {
      it('preserves the real underlying error message and cause when sync fails outside the per-item loops', async () => {
        jest.spyOn(client, 'fetchFirewallConfig').mockRejectedValue(new Error('Vercel API unavailable'))

        await expect(service.syncRules(unifiedConfig)).rejects.toThrow(
          /Failed to synchronize firewall rules:.*Failed to fetch existing firewall configuration/,
        )

        const error: unknown = await service.syncRules(unifiedConfig).catch((e) => e)
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).cause).toBeInstanceOf(Error)
      })

      it('returns a partial SyncResult (success: false, errors populated) when one operation in the middle of a loop fails, without discarding what succeeded', async () => {
        const config: UnifiedConfig = {
          version: '2.0',
          provider: 'vercel',
          rules: [
            {
              name: 'Rule A',
              enabled: true,
              conditions: [{ field: 'path', operator: 'eq', value: '/a' }],
              action: { type: 'deny' },
            },
            {
              name: 'Rule B',
              enabled: true,
              conditions: [{ field: 'path', operator: 'eq', value: '/b' }],
              action: { type: 'deny' },
            },
          ],
          ips: [],
        }

        jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
          ...mockVercelConfig,
          rules: [],
          ips: [],
        })

        const createFirewallRuleSpy = jest.spyOn(client, 'createFirewallRule')
        createFirewallRuleSpy.mockResolvedValueOnce({
          id: 'new_rule_a',
          name: 'Rule A',
          active: true,
          conditionGroup: [],
          action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
        })
        createFirewallRuleSpy.mockRejectedValueOnce(new Error('Vercel API 500'))

        const result = await service.syncRules(config)

        expect(createFirewallRuleSpy).toHaveBeenCalledTimes(2)
        expect(result.success).toBe(false)
        expect(result.rulesAdded).toBe(1)
        expect(result.errors).toBeDefined()
        expect(result.errors!.some((e) => e.includes('Rule B'))).toBe(true)
        expect(result.errors!.some((e) => e.includes('Vercel API 500'))).toBe(true)
      })
    })

    // Regression test: each client call was previously wrapped in an
    // additional `retry(fn, { maxAttempts: 3 })` on top of the retry/backoff
    // BaseFirewallClient (which VercelClient extends) already performs
    // internally — up to 3x the intended retry budget per operation, and
    // 3x the wait time before a failure surfaces. VercelFirewallService
    // should call the client exactly once per item and let the client's own
    // retry logic (invisible at this mocked-client level) handle failures.
    it('does not wrap client calls in an additional outer retry layer', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule-to-delete',
            name: 'Stale Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/stale' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [
          {
            id: 'rule-to-delete',
            name: 'Stale Rule',
            active: true,
            conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/stale' }] }],
            action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
          },
        ],
        ips: [],
      })

      const deleteFirewallRuleSpy = jest
        .spyOn(client, 'deleteFirewallRule')
        .mockRejectedValue(new Error('Vercel API 500'))

      const result = await service.syncRules({ ...config, rules: [] })

      expect(deleteFirewallRuleSpy).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(false)
    })
  })

  describe('idRemappings (regression: local-config write-back needs the real server-assigned id, not a naming-convention guess)', () => {
    it('reports an id remapping when the server assigns a different id than the local rule had', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'stale_local_id',
            name: 'My Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/a' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({ ...mockVercelConfig, rules: [], ips: [] })
      jest.spyOn(client, 'createFirewallRule').mockResolvedValue({
        id: 'rule_server_assigned',
        name: 'My Rule',
        active: true,
        conditionGroup: [],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
      })

      const result = await service.syncRules(config)

      expect(result.idRemappings).toEqual([{ oldId: 'stale_local_id', newId: 'rule_server_assigned', name: 'My Rule' }])
    })

    it('omits oldId when the local rule had no id at all', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'Brand New Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/a' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({ ...mockVercelConfig, rules: [], ips: [] })
      jest.spyOn(client, 'createFirewallRule').mockResolvedValue({
        id: 'rule_server_assigned',
        name: 'Brand New Rule',
        active: true,
        conditionGroup: [],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
      })

      const result = await service.syncRules(config)

      expect(result.idRemappings).toEqual([{ newId: 'rule_server_assigned', name: 'Brand New Rule' }])
    })

    it('leaves idRemappings undefined when no rules were created', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await service.syncRules({
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_1',
            name: 'Block bots',
            enabled: true,
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      })

      expect(result.idRemappings).toBeUndefined()
    })
  })

  // Regression coverage for #179. Vercel writes rules one at a time
  // (rules.insert/rules.update), so unlike Cloudflare's full-array ruleset
  // replace, doorman can order newly-created rules but cannot reposition a
  // rule that already exists remotely — that limitation has to be stated,
  // not silently papered over.
  describe('rule priority ordering (best-effort on Vercel)', () => {
    it('creates new rules in priority order', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'third',
            enabled: true,
            priority: 30,
            conditions: [{ field: 'path', operator: 'eq', value: '/c' }],
            action: { type: 'deny' },
          },
          {
            name: 'first',
            enabled: true,
            priority: 10,
            conditions: [{ field: 'path', operator: 'eq', value: '/a' }],
            action: { type: 'deny' },
          },
          {
            name: 'second',
            enabled: true,
            priority: 20,
            conditions: [{ field: 'path', operator: 'eq', value: '/b' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({ ...mockVercelConfig, rules: [], ips: [] })
      const createSpy = jest
        .spyOn(client, 'createFirewallRule')
        .mockImplementation((rule) => Promise.resolve({ ...rule, id: `id_${rule.name}` } as never))

      await service.syncRules(config)

      const createdOrder = createSpy.mock.calls.map(([rule]) => rule.name)
      expect(createdOrder).toEqual(['first', 'second', 'third'])
    })

    it('does not warn about ordering when every rule is a fresh create (insertion order fully determines it)', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'brand new',
            enabled: true,
            priority: 1,
            conditions: [{ field: 'path', operator: 'eq', value: '/new' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({ ...mockVercelConfig, rules: [], ips: [] })
      jest
        .spyOn(client, 'createFirewallRule')
        .mockImplementation((rule) => Promise.resolve({ ...rule, id: 'id_new' } as never))

      const result = await service.syncRules(config)

      expect(result.warnings?.some((w) => w.includes('best-effort on Vercel'))).toBeFalsy()
    })

    it('warns that ordering is best-effort when prioritised rules already exist remotely', async () => {
      // rule_1 already exists in mockVercelConfig, so it can't be repositioned.
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_1',
            name: 'Block bots',
            description: 'Block bad bots',
            enabled: true,
            priority: 20,
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot' }],
            action: { type: 'deny' },
          },
        ],
        ips: [{ id: 'ip_1', ip: '1.2.3.4', hostname: 'example.com', action: 'deny', notes: 'Blocked IP' }],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await service.syncRules(config)

      expect(result.warnings?.some((w) => w.includes('best-effort on Vercel'))).toBe(true)
    })

    it('does not warn when no rule declares a priority', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_1',
            name: 'Block bots',
            description: 'Block bad bots',
            enabled: true,
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot' }],
            action: { type: 'deny' },
          },
        ],
        ips: [{ id: 'ip_1', ip: '1.2.3.4', hostname: 'example.com', action: 'deny', notes: 'Blocked IP' }],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const result = await service.syncRules(config)

      expect(result.warnings?.some((w) => w.includes('best-effort on Vercel'))).toBeFalsy()
    })
  })

  describe('post-sync verification (regression: a create/update/delete that silently did not take effect used to go unreported)', () => {
    it('warns when a created rule is missing from the post-sync remote config', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'New Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/new' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest
        .spyOn(client, 'fetchFirewallConfig')
        // Pre-sync diff: nothing exists yet.
        .mockResolvedValueOnce({ ...mockVercelConfig, rules: [], ips: [] })
        // Post-sync re-fetch: the just-created rule isn't there — e.g. an
        // eventual-consistency lag, or a create that silently no-op'd.
        .mockResolvedValueOnce({ ...mockVercelConfig, rules: [], ips: [] })
      jest.spyOn(client, 'createFirewallRule').mockResolvedValue({
        id: 'new_rule_1',
        name: 'New Rule',
        active: true,
        conditionGroup: [],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
      })

      const result = await service.syncRules(config)

      expect(result.success).toBe(true)
      expect(result.warnings).toBeDefined()
      expect(result.warnings!.some((w) => w.includes('New Rule') && w.includes('missing from the post-sync'))).toBe(
        true,
      )
    })

    it('warns when a deleted rule still appears in the post-sync remote config', async () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
        ips: [],
      }

      jest
        .spyOn(client, 'fetchFirewallConfig')
        // Pre-sync diff: the remote rule exists, gets marked for deletion.
        .mockResolvedValueOnce(mockVercelConfig)
        // Post-sync re-fetch: the "deleted" rule is still there.
        .mockResolvedValueOnce(mockVercelConfig)
      jest.spyOn(client, 'deleteFirewallRule').mockResolvedValue(undefined)
      // mockVercelConfig also has an IP rule not present in `config.ips`,
      // so it's marked for deletion too — mock it out so it doesn't fail
      // as a real (unmocked-fetch) API call and pollute `result.success`.
      jest.spyOn(client, 'deleteIPBlockingRule').mockResolvedValue(undefined)

      const result = await service.syncRules(config)

      expect(result.success).toBe(true)
      expect(result.warnings).toBeDefined()
      expect(result.warnings!.some((w) => w.includes('rule_1') && w.includes('still appears in the post-sync'))).toBe(
        true,
      )
    })

    it('leaves warnings undefined when nothing needed to change (no mutations, nothing to verify)', async () => {
      const config: UnifiedConfig = { version: '2.0', provider: 'vercel', rules: [], ips: [] }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({ ...mockVercelConfig, rules: [], ips: [] })

      const result = await service.syncRules(config)

      expect(result.success).toBe(true)
      expect(result.rulesAdded + result.rulesUpdated + result.rulesDeleted).toBe(0)
      expect(result.warnings).toBeUndefined()
    })
  })

  describe('getChanges', () => {
    const unifiedConfig: UnifiedConfig = {
      version: '2.0',
      provider: 'vercel',
      rules: [
        {
          id: 'rule_1',
          name: 'Block bots',
          description: 'Block bad bots',
          enabled: true,
          conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot' }],
          action: { type: 'deny' },
        },
        {
          name: 'New rule',
          enabled: true,
          conditions: [{ field: 'path', operator: 'eq', value: '/admin' }],
          action: { type: 'deny' },
        },
      ],
      ips: [],
    }

    // #183 — Vercel doesn't implement managed rule groups. A config that
    // declares them must fail loudly (BaseFirewallService.assertManagedRulesSupported),
    // not silently report a clean diff/sync while quietly ignoring what the
    // user asked for.
    it('throws a clear error when the config declares managedRules', async () => {
      const configWithManagedRules: UnifiedConfig = {
        ...unifiedConfig,
        rules: [],
        managedRules: [{ ruleset: 'some-vendor-ruleset', enabled: true }],
      }

      await expect(service.getChanges(configWithManagedRules)).rejects.toThrow(/does not support managed rule groups/)
    })

    it('should detect additions', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [mockVercelConfig.rules[0]!],
        ips: [],
      })

      const changes = await service.getChanges(unifiedConfig)

      expect(changes.rulesToAdd.length).toBeGreaterThanOrEqual(1)
      expect(changes.hasChanges).toBe(true)
    })

    it('should detect deletions', async () => {
      const configWithNoRules: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const changes = await service.getChanges(configWithNoRules)

      expect(changes.rulesToDelete.length).toBeGreaterThanOrEqual(1)
      expect(changes.hasChanges).toBe(true)
    })

    it('should detect no changes when configs match', async () => {
      // Create a config that matches the remote exactly
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [],
        ips: [],
      })

      const emptyConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
        ips: [],
      }

      const changes = await service.getChanges(emptyConfig)

      expect(changes.hasChanges).toBe(false)
    })

    it('should detect no changes for a non-trivial rule with an ordinary (non-negated) condition (regression test for #203)', async () => {
      // Empty rules/ips (above) can never exercise the diff comparison this
      // guards — vercelToUnified previously wrote `negated: condition.neg`
      // and `key: condition.key` unconditionally, so an ordinary condition
      // (no `neg`/`key` in the source) translated to `negated: undefined`/
      // `key: undefined` rather than omitting the keys entirely. isDeepEqual
      // treats that as a different object shape than the local config (which,
      // loaded from disk, never has those keys at all — JSON.stringify drops
      // `undefined`), so this rule would show up as a phantom "update" on
      // every single sync. Same bug, same fix shape, as Fastly's
      // pushUnifiedCondition (see FastlyFirewallService.test.ts).
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [mockVercelConfig.rules[0]!],
        ips: [],
      })

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_1',
            name: 'Block bots',
            description: 'Block bad bots',
            enabled: true,
            // Deliberately no `negated`/`key` keys — matches what a real
            // local .doorman.json has for an ordinary condition. `group: 0`
            // and `conditionLogic: 'AND'` are included because
            // vercelToUnified legitimately always sets both (source group
            // index; single-group default) — they're not part of the
            // undefined-vs-absent bug this test targets. (`conditionLogic`
            // can be omitted safely too now — see the #225 regression test
            // below — but it's kept explicit here to isolate this test to
            // the one bug it targets.)
            conditionLogic: 'AND',
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot', group: 0 }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      const changes = await service.getChanges(config)

      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('should detect no changes for an ex/nex condition with no value (regression test for #231)', async () => {
      // Same bug class as #203 above, one field over: vercelToUnified wrote
      // `value: condition.value` unconditionally, which is `undefined` for
      // an `ex`/`nex` condition by design (#213) — so the in-memory
      // translated remote rule had a real `value: undefined` key that a
      // local config (loaded from disk, where JSON.stringify already
      // dropped it) could never match structurally.
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [
          {
            id: 'rule_3',
            name: 'Allow Supabase Cookies',
            active: true,
            conditionGroup: [{ conditions: [{ type: 'cookie' as const, op: 'nex' as const, key: 'supabase_auth' }] }],
            action: { mitigate: { action: 'bypass' as const } },
          },
        ],
        ips: [],
      })

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_3',
            name: 'Allow Supabase Cookies',
            enabled: true,
            conditionLogic: 'AND',
            // No `value` key — matches what vercelToUnified now produces,
            // and what a real ex/nex rule looks like once saved to disk.
            conditions: [{ field: 'cookie', operator: 'not_exists', key: 'supabase_auth', group: 0 }],
            action: { type: 'bypass' },
          },
        ],
        ips: [],
      }

      const changes = await service.getChanges(config)

      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('should detect no changes for a local rule that omits conditionLogic (regression test for #225)', async () => {
      // getChanges previously diffed the raw `config` parameter rather than
      // `unifiedConfigSchema.safeParse(config).data` — so a local rule
      // relying on the documented `conditionLogic` default ('AND') never
      // actually got it applied before comparison, while the translated
      // remote side (vercelToUnified) always sets it explicitly. One fewer
      // key on the local side made isDeepEqual flag every such rule as a
      // phantom "update".
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [mockVercelConfig.rules[0]!],
        ips: [],
      })

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_1',
            name: 'Block bots',
            description: 'Block bad bots',
            enabled: true,
            // No `conditionLogic` key at all — relies entirely on the
            // schema's documented default.
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot', group: 0 }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      const changes = await service.getChanges(config)

      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('should detect no changes for a rate-limit rule with only requests/window set (regression test for #203)', async () => {
      // Same class of bug, one level up from conditions: vercelToUnified's
      // action-building previously wrote rateLimit/redirect/duration (and,
      // nested, characteristics/mitigationTimeout/countingExpression) as
      // undefined-valued keys rather than omitting them, for exactly the
      // shape doorman's own "Rate Limit API" template produces (requests +
      // window only, nothing else).
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [
          {
            id: 'rule_2',
            name: 'Rate Limit API',
            active: true,
            conditionGroup: [{ conditions: [{ type: 'path' as const, op: 'pre' as const, value: '/api/' }] }],
            action: {
              mitigate: {
                action: 'rate_limit' as const,
                rateLimit: { requests: 100, window: '1m' },
                redirect: null,
                actionDuration: null,
              },
            },
          },
        ],
        ips: [],
      })

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_2',
            name: 'Rate Limit API',
            enabled: true,
            conditionLogic: 'AND',
            conditions: [{ field: 'path', operator: 'starts_with', value: '/api/', group: 0 }],
            action: { type: 'rate_limit', rateLimit: { requests: 100, window: '1m' } },
          },
        ],
        ips: [],
      }

      const changes = await service.getChanges(config)

      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('should detect no changes for a redirect rule with permanent unset (regression test for #203)', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [
          {
            id: 'rule_3',
            name: 'Redirect old page',
            active: true,
            conditionGroup: [{ conditions: [{ type: 'path' as const, op: 'eq' as const, value: '/old' }] }],
            action: {
              mitigate: {
                action: 'redirect' as const,
                redirect: { location: '/new' },
                rateLimit: null,
                actionDuration: null,
              },
            },
          },
        ],
        ips: [],
      })

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_3',
            name: 'Redirect old page',
            enabled: true,
            conditionLogic: 'AND',
            conditions: [{ field: 'path', operator: 'eq', value: '/old', group: 0 }],
            action: { type: 'redirect', redirect: { location: '/new' } },
          },
        ],
        ips: [],
      }

      const changes = await service.getChanges(config)

      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('should include version from remote config', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const changes = await service.getChanges(unifiedConfig)

      expect(changes.version).toBe(mockVercelConfig.version)
    })

    it('should detect an update when a rule with the same id has different content', async () => {
      const configWithModifiedRule: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            id: 'rule_1',
            name: 'Block bots',
            description: 'Modified description',
            enabled: true,
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({ ...mockVercelConfig, ips: [] })

      const changes = await service.getChanges(configWithModifiedRule)

      expect(changes.rulesToUpdate).toHaveLength(1)
      expect(changes.rulesToUpdate[0]?.id).toBe('rule_1')
      expect(changes.rulesToAdd).toHaveLength(0)
      expect(changes.rulesToDelete).toHaveLength(0)
    })

    it('should detect an IP rule update when hostname/notes change for the same id', async () => {
      const configWithModifiedIP: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
        ips: [{ id: 'ip_1', ip: '1.2.3.4', hostname: 'changed.example.com', action: 'deny', notes: 'Blocked IP' }],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({ ...mockVercelConfig, rules: [] })

      const changes = await service.getChanges(configWithModifiedIP)

      expect(changes.ipsToUpdate).toHaveLength(1)
      expect(changes.ipsToUpdate?.[0]?.hostname).toBe('changed.example.com')
      expect(changes.ipsToAdd).toHaveLength(0)
      expect(changes.ipsToDelete).toHaveLength(0)
    })

    it('should detect no changes for an IP rule with no hostname/notes set (regression test for #203)', async () => {
      // Same class of bug as the rule-level fixes above, in
      // vercelIPToUnified: a hostname-less IP rule (the real #219 scenario)
      // previously still produced `hostname: undefined, notes: undefined`
      // keys, so it would phantom-diff on every sync too.
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({
        ...mockVercelConfig,
        rules: [],
        ips: [{ id: 'ip_2', ip: '192.168.1.100/32', action: 'deny' as const }],
      })

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
        ips: [{ id: 'ip_2', ip: '192.168.1.100/32', action: 'deny' }],
      }

      const changes = await service.getChanges(config)

      expect(changes.ipsToUpdate).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('treats an id-less local rule as an addition rather than matching it to an unrelated remote rule', async () => {
      const configWithIdlessRule: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'Rule Without ID',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue({ ...mockVercelConfig, rules: [], ips: [] })

      const changes = await service.getChanges(configWithIdlessRule)

      expect(changes.rulesToAdd).toHaveLength(1)
      expect(changes.rulesToAdd[0]?.name).toBe('Rule Without ID')
    })

    it('rejects a rule with no conditions before ever contacting the API', async () => {
      const configWithEmptyConditions: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'Malformed Rule',
            enabled: true,
            conditions: [],
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }
      const fetchSpy = jest.spyOn(client, 'fetchFirewallConfig')

      await expect(service.getChanges(configWithEmptyConditions)).rejects.toThrow('Invalid firewall configuration')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('rejects an IP rule with a malformed address before ever contacting the API', async () => {
      const configWithBadIP: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
        ips: [{ ip: 'not-an-ip-address', hostname: 'test-host', action: 'deny' }],
      }
      const fetchSpy = jest.spyOn(client, 'fetchFirewallConfig')

      await expect(service.getChanges(configWithBadIP)).rejects.toThrow('Invalid firewall configuration')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should throw on error', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockRejectedValue(new Error('API error'))

      await expect(service.getChanges(unifiedConfig)).rejects.toThrow('Failed to fetch existing firewall configuration')
    })
  })

  describe('validateConfig', () => {
    it('should return a validation result object', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'Test rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
            action: { type: 'deny' },
          },
        ],
      }

      const result = service.validateConfig(config)

      // The unified format doesn't match the Vercel-specific firewallConfigSchema,
      // so schema validation will add errors, but the result structure is correct
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('warnings')
      expect(Array.isArray(result.errors)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
    })

    it('should pass base validation for config with rules array', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
      }

      const result = service.validateConfig(config)

      // No base validation errors (rules array exists), but schema validation may add errors
      const baseErrors = result.errors.filter(
        (e) => e.code === 'CONFIG_REQUIRED' || e.code === 'RULES_REQUIRED' || e.code === 'RULES_INVALID_TYPE',
      )
      expect(baseErrors).toHaveLength(0)
    })

    it('should report error for wrong provider', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
      }

      const result = service.validateConfig(config)

      expect(result.errors.some((e) => e.code === 'INVALID_PROVIDER')).toBe(true)
    })

    it('should report error for missing rules', () => {
      const config = {
        version: '2.0',
        provider: 'vercel',
      } as unknown as UnifiedConfig

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
    })
  })

  describe('getHealthScore', () => {
    it('should return a health score', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'Test rule',
            description: 'A test rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
            action: { type: 'rate_limit', rateLimit: { requests: 100, window: '60s' } },
          },
        ],
        ips: [{ ip: '1.2.3.4', action: 'deny' }],
      }

      const score = service.getHealthScore(config)

      expect(score.score).toBeGreaterThanOrEqual(0)
      expect(score.score).toBeLessThanOrEqual(100)
      expect(score.grade).toBeDefined()
      expect(score.issues).toBeDefined()
      expect(score.recommendations).toBeDefined()
    })

    it('should flag missing rate limiting rules', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'Test rule',
            description: 'A test rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
            action: { type: 'deny' },
          },
        ],
        ips: [{ ip: '1.2.3.4', action: 'deny' }],
      }

      const score = service.getHealthScore(config)

      expect(score.issues.some((i) => i.message.includes('rate limiting'))).toBe(true)
    })

    it('should flag missing IP blocking rules', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [
          {
            name: 'Test rule',
            description: 'A test rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
            action: { type: 'rate_limit', rateLimit: { requests: 100, window: '60s' } },
          },
        ],
        ips: [],
      }

      const score = service.getHealthScore(config)

      expect(score.issues.some((i) => i.message.includes('IP blocking'))).toBe(true)
    })

    it('should return score >= 0', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
        ips: [],
      }

      const score = service.getHealthScore(config)

      expect(score.score).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getSupportedFeatures', () => {
    it('should return Vercel feature set', () => {
      const features = service.getSupportedFeatures()

      expect(features.supportsCustomRules).toBe(true)
      expect(features.supportsIPBlocking).toBe(true)
      expect(features.supportsRateLimiting).toBe(true)
      expect(features.supportsGeoBlocking).toBe(true)
      expect(features.supportsManagedRules).toBe(false)
      expect(features.supportsRedirect).toBe(true)
      expect(features.supportsChallenge).toBe(true)
    })
  })

  describe('verifyCredentials', () => {
    it('should delegate to client.verifyCredentials', async () => {
      const spy = jest.spyOn(client, 'verifyCredentials').mockResolvedValue(true)

      const result = await service.verifyCredentials()

      expect(result).toBe(true)
      expect(spy).toHaveBeenCalled()
    })

    it('should return false when client returns false', async () => {
      jest.spyOn(client, 'verifyCredentials').mockResolvedValue(false)

      const result = await service.verifyCredentials()

      expect(result).toBe(false)
    })
  })
})
