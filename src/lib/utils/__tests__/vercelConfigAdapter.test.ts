jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { toUnifiedConfig, applySyncResultToConfig, fromUnifiedConfig } from '../vercelConfigAdapter'
import type { FirewallConfig, CustomRule, IPBlockingRule } from '../../types'
import type { UnifiedConfig } from '../../types/unified'
import type { SyncResult } from '../../providers/IFirewallProvider'

function makeLegacyRule(overrides: Partial<CustomRule> = {}): CustomRule {
  return {
    id: 'rule_test',
    name: 'Test Rule',
    description: 'A test rule',
    conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/api' }] }],
    action: { mitigate: { action: 'deny' } },
    active: true,
    ...overrides,
  }
}

function makeLegacyIPRule(overrides: Partial<IPBlockingRule> = {}): IPBlockingRule {
  return {
    id: 'ip_test',
    ip: '10.0.0.1',
    hostname: 'example.com',
    notes: 'blocked',
    action: 'deny',
    ...overrides,
  }
}

function makeLegacyConfig(overrides: Partial<FirewallConfig> = {}): FirewallConfig {
  return {
    version: 3,
    updatedAt: '2024-01-01T00:00:00Z',
    projectId: 'proj_123',
    teamId: 'team_456',
    firewallEnabled: true,
    rules: [makeLegacyRule()],
    ips: [makeLegacyIPRule()],
    ...overrides,
  }
}

describe('vercelConfigAdapter', () => {
  describe('toUnifiedConfig', () => {
    it('passes through a config that already has provider metadata unchanged', () => {
      const unified: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        providers: { vercel: { projectId: 'proj_123' } },
        rules: [],
        ips: [],
      }

      const result = toUnifiedConfig(unified)

      expect(result).toBe(unified)
    })

    it('converts a legacy config into a unified config with provider metadata set', () => {
      const legacy = makeLegacyConfig()

      const result = toUnifiedConfig(legacy)

      expect(result.provider).toBe('vercel')
      expect(result.providers?.vercel).toEqual({ projectId: 'proj_123', teamId: 'team_456' })
      expect(result.rules).toHaveLength(1)
      expect(result.rules[0]).toMatchObject({
        id: 'rule_test',
        name: 'Test Rule',
        conditions: [{ field: 'path', operator: 'eq', value: '/api', group: 0 }],
      })
    })

    it('hoists top-level version/updatedAt into metadata', () => {
      const legacy = makeLegacyConfig({ version: 7, updatedAt: '2024-06-01T00:00:00Z' })

      const result = toUnifiedConfig(legacy)

      expect(result.metadata?.version).toBe(7)
      expect(result.metadata?.updatedAt).toBe('2024-06-01T00:00:00Z')
      // Top-level `version` on the unified side is the config *format*
      // string, not the remote version number — must not be conflated.
      expect(result.version).toBe('2.0')
    })

    it('converts IP rules, preserving notes and hostname', () => {
      const legacy = makeLegacyConfig({ ips: [makeLegacyIPRule({ notes: 'suspicious traffic' })] })

      const result = toUnifiedConfig(legacy)

      expect(result.ips).toHaveLength(1)
      expect(result.ips?.[0]).toMatchObject({
        id: 'ip_test',
        ip: '10.0.0.1',
        hostname: 'example.com',
        notes: 'suspicious traffic',
      })
    })

    it('converts an id-less rule without throwing', () => {
      const legacy = makeLegacyConfig({ rules: [makeLegacyRule({ id: undefined })] })

      const result = toUnifiedConfig(legacy)

      expect(result.rules[0]?.id).toBeUndefined()
      expect(result.rules[0]?.name).toBe('Test Rule')
    })

    // Regression coverage for the condition-group fidelity fix this adapter
    // depends on: a legacy rule with 2+ condition groups must not collapse
    // into a single flat group when converted.
    it('preserves multi-group rules through the conversion', () => {
      const legacy = makeLegacyConfig({
        rules: [
          makeLegacyRule({
            conditionGroup: [
              {
                conditions: [
                  { type: 'path', op: 'eq', value: '/api' },
                  { type: 'method', op: 'eq', value: 'POST' },
                ],
              },
              { conditions: [{ type: 'header', op: 'eq', value: 'x', key: 'X-Custom' }] },
            ],
          }),
        ],
      })

      const result = toUnifiedConfig(legacy)

      const groups = new Set(result.rules[0]?.conditions.map((c) => c.group))
      expect(groups.size).toBe(2)
    })
  })

  describe('applySyncResultToConfig', () => {
    const baseResult: Pick<SyncResult, 'version' | 'updatedAt' | 'idRemappings'> = {
      version: 5,
      updatedAt: '2024-07-01T00:00:00Z',
    }

    it('writes version/updatedAt to the top level for a legacy-shaped config', () => {
      const legacy = makeLegacyConfig({ version: 3, updatedAt: '2024-01-01T00:00:00Z' })

      const { config, changed } = applySyncResultToConfig(legacy, baseResult)

      expect(changed).toBe(true)
      expect(config.version).toBe(5)
      expect(config.updatedAt).toBe('2024-07-01T00:00:00Z')
      // metadata must never appear on a legacy-shaped config — it's not
      // part of that schema.
      expect((config as unknown as Record<string, unknown>).metadata).toBeUndefined()
    })

    it('writes version/updatedAt to metadata for a unified config, leaving top-level version alone', () => {
      const unified: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        rules: [],
        ips: [],
        metadata: { version: 3, updatedAt: '2024-01-01T00:00:00Z' },
      }

      const { config, changed } = applySyncResultToConfig(unified, baseResult)

      expect(changed).toBe(true)
      expect(config.version).toBe('2.0')
      expect(config.metadata?.version).toBe(5)
      expect(config.metadata?.updatedAt).toBe('2024-07-01T00:00:00Z')
    })

    it('reports unchanged when the version already matches', () => {
      const legacy = makeLegacyConfig({ version: 5, updatedAt: '2024-07-01T00:00:00Z' })

      const { changed } = applySyncResultToConfig(legacy, baseResult)

      expect(changed).toBe(false)
    })

    it('remaps a rule id by matching on oldId', () => {
      const legacy = makeLegacyConfig({ rules: [makeLegacyRule({ id: 'stale_id', name: 'My Rule' })] })

      const { config, changed } = applySyncResultToConfig(legacy, {
        idRemappings: [{ oldId: 'stale_id', newId: 'rule_abc123', name: 'My Rule' }],
      })

      expect(changed).toBe(true)
      expect(config.rules[0]?.id).toBe('rule_abc123')
    })

    it('remaps an id-less rule by matching on name', () => {
      const legacy = makeLegacyConfig({ rules: [makeLegacyRule({ id: undefined, name: 'Brand New Rule' })] })

      const { config, changed } = applySyncResultToConfig(legacy, {
        idRemappings: [{ newId: 'rule_xyz789', name: 'Brand New Rule' }],
      })

      expect(changed).toBe(true)
      expect(config.rules[0]?.id).toBe('rule_xyz789')
    })

    it('does not touch rules with no matching remapping', () => {
      const legacy = makeLegacyConfig({ rules: [makeLegacyRule({ id: 'unrelated_id', name: 'Other Rule' })] })

      const { config, changed } = applySyncResultToConfig(legacy, {
        idRemappings: [{ oldId: 'stale_id', newId: 'rule_abc123', name: 'My Rule' }],
      })

      expect(changed).toBe(false)
      expect(config.rules[0]?.id).toBe('unrelated_id')
    })

    it('remaps an IP rule id by matching on oldId', () => {
      const legacy = makeLegacyConfig({ ips: [makeLegacyIPRule({ id: 'stale_ip_id', ip: '203.0.113.7' })] })

      const { config, changed } = applySyncResultToConfig(legacy, {
        idRemappings: [{ oldId: 'stale_ip_id', newId: '3000', name: '203.0.113.7' }],
      })

      expect(changed).toBe(true)
      expect(config.ips?.[0]?.id).toBe('3000')
    })

    // The real bug this covers: a brand-new IP rule (no id yet) gets one
    // assigned during sync (Cloud Armor's priority-as-id — see
    // CloudArmorFirewallService.syncRules), which must be matched by the IP
    // address itself, the same way an id-less *rule* is matched by name.
    // Reproduced against a real GCP project during #187's e2e verification:
    // this write-back previously only ever touched `config.rules`, so a
    // freshly-synced `ips[]` entry kept its `id: undefined` forever — every
    // following `status`/`diff` then read it as a brand-new local IP with no
    // remote match, and the real remote entry as an orphaned delete.
    it('remaps an id-less IP rule by matching on its ip address', () => {
      const legacy = makeLegacyConfig({ ips: [makeLegacyIPRule({ id: undefined, ip: '198.51.100.9' })] })

      const { config, changed } = applySyncResultToConfig(legacy, {
        idRemappings: [{ newId: '4000', name: '198.51.100.9' }],
      })

      expect(changed).toBe(true)
      expect(config.ips?.[0]?.id).toBe('4000')
    })

    it('does not touch ips with no matching remapping', () => {
      const legacy = makeLegacyConfig({ ips: [makeLegacyIPRule({ id: 'unrelated_ip_id', ip: '192.0.2.1' })] })

      const { config, changed } = applySyncResultToConfig(legacy, {
        idRemappings: [{ oldId: 'stale_ip_id', newId: '3000', name: '203.0.113.7' }],
      })

      expect(changed).toBe(false)
      expect(config.ips?.[0]?.id).toBe('unrelated_ip_id')
    })

    it('reports unchanged and returns an equivalent config when there is nothing to write back', () => {
      const legacy = makeLegacyConfig({ version: 5 })

      const { changed } = applySyncResultToConfig(legacy, { version: 5 })

      expect(changed).toBe(false)
    })
  })

  describe('fromUnifiedConfig', () => {
    const remoteUnified: UnifiedConfig = {
      version: '2.0',
      provider: 'vercel',
      providers: { vercel: { projectId: 'proj_remote', teamId: 'team_remote' } },
      rules: [
        {
          id: 'rule_remote_1',
          name: 'Remote Rule',
          enabled: true,
          conditions: [{ field: 'path', operator: 'eq', value: '/remote' }],
          action: { type: 'deny' },
        },
      ],
      ips: [{ id: 'ip_remote_1', ip: '9.9.9.9', hostname: 'remote.example.com', notes: 'from remote', action: 'deny' }],
      metadata: { version: 9, updatedAt: '2024-08-01T00:00:00Z' },
    }

    it('converts a fetched unified config back into legacy shape when the existing config was legacy', () => {
      const existing = makeLegacyConfig({ projectId: 'proj_old', teamId: 'team_old' })

      const result = fromUnifiedConfig(remoteUnified, existing) as FirewallConfig

      expect(result.version).toBe(9)
      expect(result.updatedAt).toBe('2024-08-01T00:00:00Z')
      expect(result.projectId).toBe('proj_remote')
      expect(result.teamId).toBe('team_remote')
      expect(result.rules).toHaveLength(1)
      expect(result.rules[0]).toMatchObject({
        id: 'rule_remote_1',
        name: 'Remote Rule',
        conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/remote' }] }],
        action: { mitigate: { action: 'deny' } },
      })
      expect(result.ips).toHaveLength(1)
      expect(result.ips?.[0]).toMatchObject({ ip: '9.9.9.9', hostname: 'remote.example.com', notes: 'from remote' })
    })

    it('preserves legacy-only fields (like $schema) that the remote config knows nothing about', () => {
      const existing = makeLegacyConfig({ $schema: 'https://doorman.griffen.codes/schema.json' })

      const result = fromUnifiedConfig(remoteUnified, existing) as FirewallConfig

      expect(result.$schema).toBe('https://doorman.griffen.codes/schema.json')
    })

    it('falls back to the existing projectId/teamId when the remote config has none', () => {
      const existing = makeLegacyConfig({ projectId: 'proj_old', teamId: 'team_old' })
      const remoteWithoutProviders: UnifiedConfig = { ...remoteUnified, providers: undefined }

      const result = fromUnifiedConfig(remoteWithoutProviders, existing) as FirewallConfig

      expect(result.projectId).toBe('proj_old')
      expect(result.teamId).toBe('team_old')
    })

    it('does not corrupt the real version with the unified format string ("2.0")', () => {
      const existing = makeLegacyConfig({ version: 4 })

      const result = fromUnifiedConfig(remoteUnified, existing) as FirewallConfig

      expect(result.version).not.toBe('2.0')
      expect(result.version).toBe(9)
    })

    it('merges directly when the existing config was already unified', () => {
      const existingUnified: UnifiedConfig = {
        version: '2.0',
        provider: 'vercel',
        providers: { vercel: { projectId: 'proj_old' } },
        rules: [],
        ips: [],
        metadata: { version: 3 },
      }

      const result = fromUnifiedConfig(remoteUnified, existingUnified) as UnifiedConfig

      expect(result.metadata?.version).toBe(9)
      expect(result.rules).toHaveLength(1)
      expect(result.rules[0]?.name).toBe('Remote Rule')
    })
  })
})
