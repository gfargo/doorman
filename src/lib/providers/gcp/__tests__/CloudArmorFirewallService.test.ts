import { CloudArmorFirewallService } from '../CloudArmorFirewallService'
import { CloudArmorClient } from '../CloudArmorClient'
import { unifiedToGcp } from '../translator'
import type { CloudArmorRule, CloudArmorSecurityPolicy } from '../../../types/gcp'
import type { UnifiedConfig, UnifiedRule } from '../../../types/unified'

jest.mock('../../../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { OperationSafety } from '../../../utils/operationSafety'

function policy(rules: CloudArmorRule[] = []): CloudArmorSecurityPolicy {
  return { id: 'policy-1', name: 'doorman-policy', rules, fingerprint: 'fp-1' }
}

const blockAdminRule: CloudArmorRule = {
  priority: 1000,
  description: 'Block admin',
  match: { expr: { expression: "request.path == '/admin'" } },
  action: 'deny(403)',
}

describe('CloudArmorFirewallService', () => {
  let service: CloudArmorFirewallService
  let client: CloudArmorClient

  beforeEach(() => {
    client = new CloudArmorClient('my-project', 'doorman-policy')
    service = new CloudArmorFirewallService(client)
    jest.clearAllMocks()
    jest.spyOn(OperationSafety, 'confirmDestructiveOperation').mockResolvedValue(true)
  })

  describe('name', () => {
    it('is "gcp"', () => {
      expect(service.name).toBe('gcp')
    })
  })

  describe('fetchConfig', () => {
    it('fetches and converts custom rules to UnifiedConfig', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule]))

      const result = await service.fetchConfig()

      expect(result.version).toBe('2.0')
      expect(result.provider).toBe('gcp')
      expect(result.rules).toHaveLength(1)
      expect(result.rules[0]!.name).toBe('Block admin')
      expect(result.ips).toHaveLength(0)
    })

    it('sets providers.gcp alongside provider', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([]))

      const result = await service.fetchConfig()

      expect(result.providers?.gcp).toEqual({ projectId: 'my-project', policyName: 'doorman-policy' })
    })

    it('classifies an IP-shaped rule into ips, not rules', async () => {
      const ipRule: CloudArmorRule = {
        priority: 2000,
        match: { expr: { expression: "origin.ip == '203.0.113.9'" } },
        action: 'deny(403)',
      }
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule, ipRule]))

      const result = await service.fetchConfig()

      expect(result.rules).toHaveLength(1)
      expect(result.ips).toHaveLength(1)
      expect(result.ips![0]).toMatchObject({ ip: '203.0.113.9', action: 'deny' })
    })
  })

  describe('getChanges', () => {
    const baseConfig: UnifiedConfig = { version: '2.0', provider: 'gcp', rules: [], ips: [] }

    it('reports no changes when local and remote match exactly', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule]))

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            id: '1000',
            name: 'Block admin',
            description: 'Block admin',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/admin' }],
            action: { type: 'deny' },
            priority: 1000,
          },
        ],
      }

      const changes = await service.getChanges(config)

      expect(changes.hasChanges).toBe(false)
      expect(changes.rulesToAdd).toHaveLength(0)
      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.rulesToDelete).toHaveLength(0)
    })

    it('reports a rule with no priority yet as an add, not a false-positive update', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule]))

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            name: 'Block signup abuse',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/signup' }],
            action: { type: 'deny' },
          },
        ],
      }

      const changes = await service.getChanges(config)

      expect(changes.rulesToAdd).toHaveLength(1)
      expect(changes.rulesToUpdate).toHaveLength(0)
      // The existing remote rule doorman doesn't have a local match for is a delete.
      expect(changes.rulesToDelete).toHaveLength(1)
    })

    it('reports a changed condition on an existing rule as an update', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule]))

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            id: '1000',
            name: 'Block admin',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/admin-panel' }],
            action: { type: 'deny' },
            priority: 1000,
          },
        ],
      }

      const changes = await service.getChanges(config)

      expect(changes.rulesToAdd).toHaveLength(0)
      expect(changes.rulesToUpdate).toHaveLength(1)
      expect(changes.rulesToDelete).toHaveLength(0)
    })

    it('does not misclassify a rules[]-authored single-IP rule as an ips[] entry (#248)', async () => {
      // A plain custom rule whose one condition happens to be on `ip` — CEL-
      // identical to what unifiedIPToGcp would produce for an ips[] entry,
      // since Cloud Armor has no server-side field distinguishing the two.
      const singleIpRule: UnifiedRule = {
        id: '1000',
        name: 'Block known bad actor',
        description: 'Block known bad actor',
        enabled: true,
        conditions: [{ field: 'ip', operator: 'eq', value: '198.51.100.7' }],
        action: { type: 'deny' },
        priority: 1000,
      }
      // Built via the real translator (not hand-typed CEL) so the remote
      // fixture is exactly what a prior sync of `singleIpRule` would have
      // produced — the same round-trip the bug report reproduced.
      const remoteRule: CloudArmorRule = unifiedToGcp(singleIpRule).result
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([remoteRule]))

      const config: UnifiedConfig = { ...baseConfig, rules: [singleIpRule] }
      const changes = await service.getChanges(config)

      expect(changes.hasChanges).toBe(false)
      expect(changes.rulesToAdd).toHaveLength(0)
      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.rulesToDelete).toHaveLength(0)
      // The bug's signature: the remote rule reclassified as an orphaned IP
      // entry with no local ips[] match, queued for deletion.
      expect(changes.ipsToAdd).toHaveLength(0)
      expect(changes.ipsToDelete).toHaveLength(0)
    })
  })

  describe('syncRules', () => {
    const baseConfig: UnifiedConfig = { version: '2.0', provider: 'gcp', rules: [], ips: [] }

    it('dry run makes no client calls beyond the diff', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([]))
      const addRuleSpy = jest.spyOn(client, 'addRule')

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            name: 'New rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/x' }],
            action: { type: 'deny' },
          },
        ],
      }

      const result = await service.syncRules(config, { dryRun: true })

      expect(result.success).toBe(true)
      expect(addRuleSpy).not.toHaveBeenCalled()
    })

    it('assigns a priority to a brand-new rule with none set, avoiding remote collisions', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule])) // occupies 1000
      const addRuleSpy = jest.spyOn(client, 'addRule').mockResolvedValue(undefined)

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          blockAdminRuleAsUnified(),
          {
            name: 'New rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/x' }],
            action: { type: 'deny' },
            // no priority — must be assigned, and must not collide with 1000
          },
        ],
      }

      const result = await service.syncRules(config)

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
      expect(addRuleSpy).toHaveBeenCalledTimes(1)
      const addedRule = addRuleSpy.mock.calls[0]![0] as CloudArmorRule
      expect(addedRule.priority).not.toBe(1000)
      expect(addedRule.priority).toBeGreaterThan(0)
    })

    it('assigns non-colliding priorities to two new rules added in the same sync', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([]))
      const addRuleSpy = jest.spyOn(client, 'addRule').mockResolvedValue(undefined)

      const config: UnifiedConfig = {
        ...baseConfig,
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
      }

      const result = await service.syncRules(config)

      expect(result.rulesAdded).toBe(2)
      const priorities = addRuleSpy.mock.calls.map((call) => (call[0] as CloudArmorRule).priority)
      expect(new Set(priorities).size).toBe(2)
    })

    it('deletes a rule removed from local config', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule]))
      const removeRuleSpy = jest.spyOn(client, 'removeRule').mockResolvedValue(undefined)

      const result = await service.syncRules(baseConfig)

      expect(result.rulesDeleted).toBe(1)
      expect(removeRuleSpy).toHaveBeenCalledWith(1000)
    })

    it('updates a changed rule at its existing priority, without reassigning one', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule]))
      const patchRuleSpy = jest.spyOn(client, 'patchRule').mockResolvedValue(undefined)

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            id: '1000',
            name: 'Block admin',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/admin-v2' }],
            action: { type: 'deny' },
            priority: 1000,
          },
        ],
      }

      const result = await service.syncRules(config)

      expect(result.rulesUpdated).toBe(1)
      expect(patchRuleSpy).toHaveBeenCalledWith(1000, expect.objectContaining({ priority: 1000 }))
    })

    it('relocates a rule via remove+add, not patch, when its priority changes (#249)', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule])) // remote: priority 1000
      const patchRuleSpy = jest.spyOn(client, 'patchRule').mockResolvedValue(undefined)
      const removeRuleSpy = jest.spyOn(client, 'removeRule').mockResolvedValue(undefined)
      const addRuleSpy = jest.spyOn(client, 'addRule').mockResolvedValue(undefined)

      // Same rule, id unchanged, but the user moved it to priority 2000 —
      // Cloud Armor has no PATCH-based relocation (see types/gcp.ts), so
      // this can only be honored as remove(1000) + add(...priority: 2000).
      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            id: '1000',
            name: 'Block admin',
            description: 'Block admin',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/admin' }],
            action: { type: 'deny' },
            priority: 2000,
          },
        ],
      }

      const result = await service.syncRules(config)

      expect(result.success).toBe(true)
      expect(result.rulesUpdated).toBe(1)
      expect(patchRuleSpy).not.toHaveBeenCalled()
      expect(removeRuleSpy).toHaveBeenCalledWith(1000)
      expect(addRuleSpy).toHaveBeenCalledTimes(1)
      const addedRule = addRuleSpy.mock.calls[0]![0] as CloudArmorRule
      expect(addedRule.priority).toBe(2000)
      expect(result.idRemappings).toContainEqual({ oldId: '1000', newId: '2000', name: 'Block admin' })
    })

    it('adds a new IP rule with an assigned priority', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([]))
      const addRuleSpy = jest.spyOn(client, 'addRule').mockResolvedValue(undefined)

      const config: UnifiedConfig = { ...baseConfig, ips: [{ ip: '203.0.113.9', action: 'deny' }] }

      const result = await service.syncRules(config)

      expect(result.ipsAdded).toBe(1)
      expect(addRuleSpy).toHaveBeenCalledTimes(1)
      const addedRule = addRuleSpy.mock.calls[0]![0] as CloudArmorRule
      expect(addedRule.match.expr.expression).toBe("origin.ip == '203.0.113.9'")
    })

    it('reports a per-rule failure in errors[] without aborting the rest of the sync', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([]))
      jest
        .spyOn(client, 'addRule')
        .mockRejectedValueOnce(new Error('gcp API error: 400 Bad Request - boom'))
        .mockResolvedValueOnce(undefined)

      const config: UnifiedConfig = {
        ...baseConfig,
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
      }

      const result = await service.syncRules(config)

      expect(result.success).toBe(false)
      expect(result.rulesAdded).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors![0]).toContain('boom')
    })

    it('a translation failure on one rule does not discard another rule already added in the same sync (#250)', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([]))
      const addRuleSpy = jest.spyOn(client, 'addRule').mockResolvedValue(undefined)

      const config: UnifiedConfig = {
        ...baseConfig,
        rules: [
          {
            name: 'Rule A (translatable)',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/a' }],
            action: { type: 'deny' },
          },
          {
            // `region` has no CEL mapping in CelExpressionBuilder — throws
            // during translation, not during the network call.
            name: 'Rule B (untranslatable)',
            enabled: true,
            conditions: [{ field: 'region', operator: 'eq', value: 'US' }],
            action: { type: 'deny' },
          },
        ],
      }

      const result = await service.syncRules(config)

      // syncRules must return a normal result, not throw — a thrown error
      // here means the caller (src/commands/sync.ts) never reaches
      // applySyncResultToConfig, leaving the local config permanently
      // desynced from the rule that DID get created remotely.
      expect(result.success).toBe(false)
      expect(result.rulesAdded).toBe(1)
      expect(addRuleSpy).toHaveBeenCalledTimes(1)
      expect(result.idRemappings).toHaveLength(1)
      expect(result.idRemappings![0]!.name).toBe('Rule A (translatable)')
      expect(result.errors).toHaveLength(1)
      expect(result.errors![0]).toContain('Rule B (untranslatable)')
    })

    it('does not delete+recreate a rules[]-authored single-IP rule on a second sync (#248)', async () => {
      const singleIpRule: UnifiedRule = {
        id: '1000',
        name: 'Block known bad actor',
        description: 'Block known bad actor',
        enabled: true,
        conditions: [{ field: 'ip', operator: 'eq', value: '198.51.100.7' }],
        action: { type: 'deny' },
        priority: 1000,
      }
      // The remote state a first sync of this exact rule would have left
      // behind — built via the real translator, not hand-typed CEL.
      const remoteRule: CloudArmorRule = unifiedToGcp(singleIpRule).result
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([remoteRule]))
      const addRuleSpy = jest.spyOn(client, 'addRule')
      const removeRuleSpy = jest.spyOn(client, 'removeRule')
      const patchRuleSpy = jest.spyOn(client, 'patchRule')

      const result = await service.syncRules({ ...baseConfig, rules: [singleIpRule] })

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(0)
      expect(result.rulesDeleted).toBe(0)
      expect(result.ipsAdded).toBe(0)
      expect(result.ipsDeleted).toBe(0)
      expect(addRuleSpy).not.toHaveBeenCalled()
      expect(removeRuleSpy).not.toHaveBeenCalled()
      expect(patchRuleSpy).not.toHaveBeenCalled()
    })

    it('does not call addRule/patchRule/removeRule when the user cancels the confirmation', async () => {
      jest.spyOn(client, 'getPolicy').mockResolvedValue(policy([blockAdminRule]))
      jest.spyOn(OperationSafety, 'confirmDestructiveOperation').mockResolvedValue(false)
      const removeRuleSpy = jest.spyOn(client, 'removeRule')

      await expect(service.syncRules(baseConfig)).rejects.toThrow(/cancelled/i)
      expect(removeRuleSpy).not.toHaveBeenCalled()
    })

    function blockAdminRuleAsUnified() {
      return {
        id: '1000',
        name: 'Block admin',
        description: 'Block admin',
        enabled: true,
        conditions: [{ field: 'path' as const, operator: 'eq' as const, value: '/admin' }],
        action: { type: 'deny' as const },
        priority: 1000,
      }
    }
  })

  describe('getSupportedFeatures', () => {
    it('reports no standalone challenge action', () => {
      expect(service.getSupportedFeatures().supportsChallenge).toBe(false)
    })

    it('reports custom rules, IP blocking, rate limiting, geo blocking, and redirect as supported', () => {
      const features = service.getSupportedFeatures()
      expect(features.supportsCustomRules).toBe(true)
      expect(features.supportsIPBlocking).toBe(true)
      expect(features.supportsRateLimiting).toBe(true)
      expect(features.supportsGeoBlocking).toBe(true)
      expect(features.supportsRedirect).toBe(true)
    })
  })

  describe('verifyCredentials', () => {
    it('delegates to the client', async () => {
      jest.spyOn(client, 'verifyCredentials').mockResolvedValue(true)
      expect(await service.verifyCredentials()).toBe(true)
    })
  })

  describe('validateConfig', () => {
    it('rejects a config whose provider is not gcp', () => {
      const result = service.validateConfig({
        version: '2.0',
        provider: 'vercel',
        rules: [],
      } as unknown as UnifiedConfig)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_PROVIDER')).toBe(true)
    })
  })
})
