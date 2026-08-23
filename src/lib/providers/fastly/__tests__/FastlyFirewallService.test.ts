import { FastlyFirewallService } from '../FastlyFirewallService'
import { FastlyClient, DOORMAN_DENY_LIST_NAME } from '../FastlyClient'
import type { FastlyRule, FastlyList } from '../../../types/fastly'
import type { UnifiedConfig } from '../../../types/unified'

jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import { OperationSafety } from '../../../utils/operationSafety'

describe('FastlyFirewallService', () => {
  let service: FastlyFirewallService
  let client: FastlyClient

  const mockRequestRule: FastlyRule = {
    id: 'rule_1',
    type: 'request',
    scope: { type: 'workspace', applies_to: ['workspace_1'] },
    enabled: true,
    description: 'Block bad bots',
    group_operator: 'all',
    request_logging: 'sampled',
    conditions: [{ type: 'single', field: 'user_agent', operator: 'contains', value: 'BadBot' }],
    actions: [{ type: 'block' }],
    rate_limit: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  const mockSignalRule: FastlyRule = {
    ...mockRequestRule,
    id: 'rule_signal',
    type: 'signal',
    description: 'Exclude a false-positive signal',
    actions: [{ type: 'exclude_signal', signal: 'XSS' }],
  }

  const mockDenyList: FastlyList = {
    id: 'list_deny',
    name: DOORMAN_DENY_LIST_NAME,
    description: 'Managed by doorman',
    type: 'ip',
    entries: ['1.2.3.4'],
    reference_id: '',
    scope: { type: 'workspace' },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  beforeEach(() => {
    client = new FastlyClient('workspace_1', 'test-token')
    service = new FastlyFirewallService(client)
    jest.clearAllMocks()
    jest.spyOn(OperationSafety, 'confirmDestructiveOperation').mockResolvedValue(true)
    jest.spyOn(client, 'findList').mockResolvedValue(null)
  })

  describe('name', () => {
    it('should be "fastly"', () => {
      expect(service.name).toBe('fastly')
    })
  })

  describe('fetchConfig', () => {
    it('should fetch and convert to UnifiedConfig', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([mockRequestRule])

      const result = await service.fetchConfig()

      expect(result.version).toBe('2.0')
      expect(result.provider).toBe('fastly')
      expect(result.rules).toHaveLength(1)
      expect(result.rules[0]!.name).toBe('Block bad bots')
      expect(result.rules[0]!.enabled).toBe(true)
    })

    it('should set providers.fastly alongside provider', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])

      const result = await service.fetchConfig()

      expect(result.providers?.fastly?.workspaceId).toBe('workspace_1')
    })

    it('should skip signal/templated_signal rules doorman does not manage', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([mockRequestRule, mockSignalRule])

      const result = await service.fetchConfig()

      expect(result.rules).toHaveLength(1)
      expect(result.rules[0]!.id).toBe('rule_1')
    })

    it('should convert IP list entries to unified format', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      jest
        .spyOn(client, 'findList')
        .mockImplementation((name) => Promise.resolve(name === DOORMAN_DENY_LIST_NAME ? mockDenyList : null))

      const result = await service.fetchConfig()

      expect(result.ips).toHaveLength(1)
      expect(result.ips![0]!.ip).toBe('1.2.3.4')
      expect(result.ips![0]!.action).toBe('deny')
    })

    it('should throw on error', async () => {
      jest.spyOn(client, 'fetchRules').mockRejectedValue(new Error('network down'))

      await expect(service.fetchConfig()).rejects.toThrow('Failed to fetch Fastly')
    })
  })

  describe('getChanges', () => {
    const baseConfig: UnifiedConfig = {
      version: '2.0',
      provider: 'fastly',
      rules: [],
      ips: [],
    }

    it('should detect additions', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'new-rule',
            name: 'New Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/new' }],
            action: { type: 'block' },
          },
        ],
      }

      const changes = await service.getChanges(config)
      expect(changes.rulesToAdd).toHaveLength(1)
      expect(changes.hasChanges).toBe(true)
    })

    it('should detect deletions', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([mockRequestRule])

      const changes = await service.getChanges(baseConfig)
      expect(changes.rulesToDelete).toHaveLength(1)
      expect(changes.hasChanges).toBe(true)
    })

    it('should detect no changes when configs match', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([mockRequestRule])

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'rule_1',
            name: 'Block bad bots',
            enabled: true,
            // Deliberately no `negated` key at all — a real local config
            // (persisted as JSON, which drops `undefined` values) never has
            // one for an ordinary condition. See the comment in
            // `pushUnifiedCondition` (translator.ts) for why the translator
            // must match this shape exactly rather than setting
            // `negated: undefined`.
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot', group: 0 }],
            conditionLogic: 'AND',
            action: { type: 'block' },
          },
        ],
      }

      const changes = await service.getChanges(config)
      expect(changes.rulesToAdd).toHaveLength(0)
      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.rulesToDelete).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('should detect no changes for a local rule that omits conditionLogic (regression test for #225)', async () => {
      // getChanges previously diffed the raw `config` parameter rather than
      // unifiedConfigSchema.safeParse(config).data — so a local rule relying
      // on the documented conditionLogic default ('AND') never actually got
      // it applied before comparison, while fastlyToUnified always sets it
      // explicitly on the translated remote side. One fewer key on the
      // local side made isDeepEqual flag every such rule as a phantom
      // "update". Same bug, same fix, as Vercel's getChanges.
      jest.spyOn(client, 'fetchRules').mockResolvedValue([mockRequestRule])

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'rule_1',
            name: 'Block bad bots',
            enabled: true,
            // No `conditionLogic` key at all — relies entirely on the
            // schema's documented default.
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot', group: 0 }],
            action: { type: 'block' },
          },
        ],
      }

      const changes = await service.getChanges(config)
      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('should detect an update when a rule with the same id has different content', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([mockRequestRule])

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'rule_1',
            name: 'Block bad bots',
            enabled: false,
            conditions: [{ field: 'user_agent', operator: 'contains', value: 'BadBot' }],
            action: { type: 'block' },
          },
        ],
      }

      const changes = await service.getChanges(config)
      expect(changes.rulesToUpdate).toHaveLength(1)
    })

    it('should detect IP additions and deletions against the deny list', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      jest
        .spyOn(client, 'findList')
        .mockImplementation((name) => Promise.resolve(name === DOORMAN_DENY_LIST_NAME ? mockDenyList : null))

      const config: UnifiedConfig = {
        ...baseConfig,
        ips: [{ ip: '5.6.7.8', action: 'deny' }],
      }

      const changes = await service.getChanges(config)
      expect(changes.ipsToAdd).toHaveLength(1)
      expect(changes.ipsToAdd![0]!.ip).toBe('5.6.7.8')
      expect(changes.ipsToDelete).toHaveLength(1)
      expect(changes.ipsToDelete![0]!.ip).toBe('1.2.3.4')
    })

    it('rejects a rule with no conditions before ever contacting the API', async () => {
      const fetchSpy = jest.spyOn(client, 'fetchRules')
      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [{ id: 'r1', name: 'Bad', enabled: true, conditions: [], action: { type: 'block' } }],
      }

      await expect(service.getChanges(config)).rejects.toThrow('Invalid firewall configuration')
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should throw on error', async () => {
      jest.spyOn(client, 'fetchRules').mockRejectedValue(new Error('boom'))
      await expect(service.getChanges(baseConfig)).rejects.toThrow('Failed to fetch existing Fastly configuration')
    })
  })

  describe('syncRules', () => {
    const configWithOneRule: UnifiedConfig = {
      version: '2.0',
      provider: 'fastly',
      rules: [
        {
          id: 'new-rule',
          name: 'New Rule',
          enabled: true,
          conditions: [{ field: 'path', operator: 'eq', value: '/new' }],
          action: { type: 'block' },
        },
      ],
      ips: [],
    }

    it('should return dry run result without making changes', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      const createSpy = jest.spyOn(client, 'createRule')

      const result = await service.syncRules(configWithOneRule, { dryRun: true })

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(0)
      expect(createSpy).not.toHaveBeenCalled()
    })

    it('should sync rules and return counts', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      jest.spyOn(client, 'createRule').mockResolvedValue({ ...mockRequestRule, id: 'rule_new' })

      const result = await service.syncRules(configWithOneRule, { force: true, allowDeletions: true })

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
    })

    // Regression coverage for a bug found while building the Fastly demo
    // tape (follow-up to #186/#204): `applySyncResultToConfig`'s write-back
    // only corrects a rule's local id via its name-keyed map when the local
    // rule had *no* id at all — a rule that already had some id (even a
    // local-only placeholder that never existed remotely) needs `oldId` set
    // so the id-keyed map can find it instead. Mirrors the equivalent
    // `VercelFirewallService.test.ts` describe block.
    it('reports an id remapping with oldId when the local rule already had an id', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      jest.spyOn(client, 'createRule').mockResolvedValue({ ...mockRequestRule, id: 'server-assigned-id' })

      const result = await service.syncRules(configWithOneRule, { force: true })

      expect(result.idRemappings).toEqual([{ oldId: 'new-rule', newId: 'server-assigned-id', name: 'New Rule' }])
    })

    it('omits oldId when the local rule had no id at all', async () => {
      const configWithUnidentifiedRule: UnifiedConfig = {
        version: '2.0',
        provider: 'fastly',
        rules: [
          {
            name: 'Brand New Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/new' }],
            action: { type: 'block' },
          },
        ],
        ips: [],
      }
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      jest.spyOn(client, 'createRule').mockResolvedValue({ ...mockRequestRule, id: 'server-assigned-id' })

      const result = await service.syncRules(configWithUnidentifiedRule, { force: true })

      expect(result.idRemappings).toEqual([{ newId: 'server-assigned-id', name: 'Brand New Rule' }])
    })

    it('deletes stale rules before creating new ones', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([mockRequestRule])
      const deleteSpy = jest.spyOn(client, 'deleteRule').mockResolvedValue(undefined)
      jest.spyOn(client, 'createRule').mockResolvedValue({ ...mockRequestRule, id: 'rule_new' })

      await service.syncRules(configWithOneRule, { force: true, allowDeletions: true })

      expect(deleteSpy).toHaveBeenCalledWith('rule_1')
    })

    it('returns a partial SyncResult when one operation fails, without discarding what succeeded', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      jest
        .spyOn(client, 'createRule')
        .mockResolvedValueOnce({ ...mockRequestRule, id: 'rule_ok' })
        .mockRejectedValueOnce(new Error('server rejected this rule'))

      const config: UnifiedConfig = {
        ...configWithOneRule,
        rules: [
          ...configWithOneRule.rules,
          {
            id: 'new-rule-2',
            name: 'New Rule 2',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/new2' }],
            action: { type: 'block' },
          },
        ],
      }

      const result = await service.syncRules(config, { force: true })

      expect(result.success).toBe(false)
      expect(result.rulesAdded).toBe(1)
      expect(result.errors).toHaveLength(1)
    })

    it('warns that priority has no effect on Fastly', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      jest.spyOn(client, 'createRule').mockResolvedValue({ ...mockRequestRule, id: 'rule_new' })

      const config: UnifiedConfig = {
        ...configWithOneRule,
        rules: [{ ...configWithOneRule.rules[0]!, priority: 1 }],
      }

      const result = await service.syncRules(config, { force: true })

      expect(result.warnings?.some((w) => w.includes('priority` has no effect on Fastly'))).toBe(true)
    })

    it('replaces the deny list wholesale when IP entries change', async () => {
      jest.spyOn(client, 'fetchRules').mockResolvedValue([])
      jest
        .spyOn(client, 'findList')
        .mockImplementation((name) => Promise.resolve(name === DOORMAN_DENY_LIST_NAME ? mockDenyList : null))
      jest.spyOn(client, 'getOrCreateList').mockResolvedValue(mockDenyList)
      const updateEntriesSpy = jest.spyOn(client, 'updateListEntries').mockResolvedValue(mockDenyList)

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'fastly',
        rules: [],
        ips: [{ ip: '9.9.9.9', action: 'deny' }],
      }

      const result = await service.syncRules(config, { force: true, allowDeletions: true })

      expect(updateEntriesSpy).toHaveBeenCalledWith(mockDenyList.id, ['9.9.9.9'])
      expect(result.ipsAdded).toBe(1)
      expect(result.ipsDeleted).toBe(1)
    })
  })

  describe('validateConfig', () => {
    it('should report error for wrong provider', () => {
      const config = { provider: 'vercel', rules: [] } as unknown as UnifiedConfig
      const result = service.validateConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_PROVIDER')).toBe(true)
    })

    it('should pass base validation for a config with a rules array', () => {
      const result = service.validateConfig({ provider: 'fastly', rules: [] })
      expect(result.errors.some((e) => e.code === 'RULES_REQUIRED')).toBe(false)
    })
  })

  describe('getHealthScore', () => {
    it('should flag missing rate limiting and IP blocking rules', () => {
      const score = service.getHealthScore({ provider: 'fastly', rules: [], ips: [] })
      expect(score.issues.some((i) => i.message.includes('rate limiting'))).toBe(true)
      expect(score.issues.some((i) => i.message.includes('IP blocking'))).toBe(true)
    })
  })

  describe('getSupportedFeatures', () => {
    it('should return the Fastly feature set', () => {
      const features = service.getSupportedFeatures()
      expect(features.supportsCustomRules).toBe(true)
      expect(features.supportsIPBlocking).toBe(true)
      expect(features.supportsRateLimiting).toBe(true)
      expect(features.supportsManagedRules).toBe(false)
    })
  })

  describe('verifyCredentials', () => {
    it('should delegate to client.verifyCredentials', async () => {
      const spy = jest.spyOn(client, 'verifyCredentials').mockResolvedValue(true)
      await expect(service.verifyCredentials()).resolves.toBe(true)
      expect(spy).toHaveBeenCalled()
    })

    it('should return false when client returns false', async () => {
      jest.spyOn(client, 'verifyCredentials').mockResolvedValue(false)
      await expect(service.verifyCredentials()).resolves.toBe(false)
    })
  })
})
