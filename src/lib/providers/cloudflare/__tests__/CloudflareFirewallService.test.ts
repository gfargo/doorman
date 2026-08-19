import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareFirewallService } from '../CloudflareFirewallService'
import { CloudflareClient } from '../CloudflareClient'
import type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from '../../../types/unified'
import type { CloudflareRuleset } from '../../../types/cloudflare'

// Mock logger
jest.mock('../../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// Mock OperationSafety for syncRules tests. `performDryRunValidation` delegates
// to the real `validateFn` (i.e. the real `getChanges`) instead of returning a
// canned empty `changes` object — a fixed stub here would silently decouple
// `rulesAdded`/`rulesUpdated`/`rulesDeleted` assertions below from the actual
// diff logic, which is exactly the gap that previously let `syncRules` report
// `rulesAdded: config.rules.length` unconditionally without any test catching it.
jest.mock('../../../utils/operationSafety', () => ({
  OperationSafety: {
    performDryRunValidation: jest
      .fn<(config: any, operation: string, validateFn: (c: any) => Promise<any>) => Promise<any>>()
      .mockImplementation(async (config, _operation, validateFn) => ({
        valid: true,
        changes: await validateFn(config),
        issues: [],
        warnings: [],
      })),
    confirmDestructiveOperation: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    // assessOperationRisk moved here from a CloudflareFirewallService-private
    // method (shared with VercelFirewallService — see #104); tests don't
    // assert on risk level here, so a fixed 'low' keeps the mock simple.
    assessOperationRisk: jest.fn<() => 'low' | 'medium' | 'high'>().mockReturnValue('low'),
  },
}))

describe('CloudflareFirewallService', () => {
  const API_TOKEN = 'test-token'
  const ZONE_ID = 'test-zone-id'
  const ACCOUNT_ID = 'test-account-id'

  let service: CloudflareFirewallService
  let mockClient: CloudflareClient

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks()

    // Create service with account ID (enables Lists)
    service = new CloudflareFirewallService(API_TOKEN, ZONE_ID, ACCOUNT_ID)

    // Get the client instance to mock its methods
    mockClient = service['client']

    // Default Lists-API mocks so getChanges()'s IP-diffing path (now
    // genuinely exercised, since performDryRunValidation above delegates to
    // the real getChanges instead of skipping it) doesn't fall through to a
    // real, hanging network call in tests that don't care about IP state.
    // Tests that do care override these with their own jest.spyOn(...) calls.
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
      id: 'list-1',
      name: 'Doorman IP Blocklist',
      description: 'Test',
      kind: 'ip',
      num_items: 0,
      num_referencing_filters: 0,
      created_on: '2024-01-01T00:00:00Z',
      modified_on: '2024-01-01T00:00:00Z',
    })
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('fetchConfig', () => {
    it('should fetch configuration from Cloudflare', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test Description',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '5',
        last_updated: '2024-01-01T00:00:00Z',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'http.request.uri.path eq "/blocked"',
            description: 'Block specific path',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      expect(config.version).toBe('2.0')
      expect(config.provider).toBe('cloudflare')
      expect(config.rules).toHaveLength(1)
      expect(config.metadata?.version).toBe(5)
      expect(mockClient.getOrCreateFirewallRuleset).toHaveBeenCalledTimes(1)
    })

    it('should fetch IPs from Lists when account ID is provided', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 2,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([
        {
          id: 'item-1',
          ip: '192.168.1.1',
          comment: 'Test IP 1',
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
        {
          id: 'item-2',
          ip: '192.168.1.2',
          comment: 'Test IP 2',
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ])

      const config = await service.fetchConfig()

      expect(config.ips).toHaveLength(2)
      expect(config.ips?.[0]?.ip).toBe('192.168.1.1')
      expect(config.ips?.[1]?.ip).toBe('192.168.1.2')
      expect(mockClient.getOrCreateIPBlocklist).toHaveBeenCalledTimes(1)
      expect(mockClient.getListItems).toHaveBeenCalledWith('list-1')
    })

    it('should handle List-based IP rules in ruleset', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'ip.src in $doorman_ip_blocklist',
            description: 'Block IPs in Doorman IP Blocklist',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      // List-based rules should be skipped in rules array (IPs fetched separately)
      expect(config.rules).toHaveLength(0)
    })

    it('should handle individual IP blocking rules', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'ip.src eq 192.168.1.100',
            description: 'Block specific IP (example.com)',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      expect(config.ips).toHaveLength(1)
      expect(config.ips?.[0]?.ip).toBe('192.168.1.100')
      expect(config.ips?.[0]?.hostname).toBe('example.com')
    })

    // Regression test: a single-IP-shaped rule (`ip.src eq <ip>`) whose
    // action is something other than block/allow — e.g. challenge or log —
    // was previously misclassified as a plain IP block/allow rule anyway,
    // silently discarding its real action. It must instead be treated as a
    // regular rule.
    it('does not treat a single-IP rule with a non-block/allow action as an IP blocking rule', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'challenge',
            expression: 'ip.src eq 192.168.1.100',
            description: 'Challenge a specific IP',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      expect(config.ips).toHaveLength(0)
      expect(config.rules).toHaveLength(1)
      expect(config.rules[0]?.action.type).toBe('challenge')
    })

    it('should recognize a CIDR IP-blocking rule using the `in {...}` set form (regression test)', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'ip.src in {192.168.1.0/24}',
            description: 'Block IP range (example.com)',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      // Must round-trip as an IP rule, not a generic custom rule
      expect(config.rules).toHaveLength(0)
      expect(config.ips).toHaveLength(1)
      expect(config.ips?.[0]?.ip).toBe('192.168.1.0/24')
      expect(config.ips?.[0]?.hostname).toBe('example.com')
    })

    it('should recognize a plain IPv6 IP-blocking rule (regression test)', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'ip.src eq 2001:db8::1',
            description: 'Block specific IP (example.com)',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      expect(config.rules).toHaveLength(0)
      expect(config.ips).toHaveLength(1)
      expect(config.ips?.[0]?.ip).toBe('2001:db8::1')
      expect(config.ips?.[0]?.hostname).toBe('example.com')
    })

    it('should recognize an IPv6 CIDR IP-blocking rule using the `in {...}` set form (regression test)', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'ip.src in {2001:db8::/32}',
            description: 'Block IP range',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      expect(config.rules).toHaveLength(0)
      expect(config.ips).toHaveLength(1)
      expect(config.ips?.[0]?.ip).toBe('2001:db8::/32')
    })

    it('should not misclassify a List-based IP rule as a CIDR set-literal rule', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'ip.src in $doorman_ip_blocklist',
            description: 'Block IPs in Doorman IP Blocklist',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      // List-based rules are skipped from both `rules` and inline `ips`
      // (their IPs are fetched separately from the Cloudflare List)
      expect(config.rules).toHaveLength(0)
      expect(config.ips).toHaveLength(0)
    })

    it('should continue if Lists API fails', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockRejectedValue(new Error('Lists API error'))

      const config = await service.fetchConfig()

      expect(config.rules).toHaveLength(0)
      expect(config.ips).toHaveLength(0)
      // Should not throw, just log warning
    })
  })

  describe('syncRules', () => {
    it('should sync rules in dry run mode', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Test Rule',
            description: 'Test Description',
            enabled: true,
            action: {
              type: 'deny',
            },
            conditions: [
              {
                field: 'path',
                operator: 'eq',
                value: '/test',
              },
            ],
          },
        ],
        ips: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue({
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      })
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])
      const updateRulesetSpy = jest.spyOn(mockClient, 'updateRuleset')

      // Override OperationSafety mock for dry run to return expected changes
      const { OperationSafety } = require('../../../utils/operationSafety')
      OperationSafety.performDryRunValidation.mockResolvedValueOnce({
        valid: true,
        changes: {
          rulesToAdd: [mockConfig.rules[0]],
          rulesToUpdate: [],
          rulesToDelete: [],
          ipsToAdd: [],
          ipsToUpdate: [],
          ipsToDelete: [],
          hasChanges: true,
        },
        issues: [],
        warnings: [],
      })

      const result = await service.syncRules(mockConfig, { dryRun: true })

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
      expect(updateRulesetSpy).not.toHaveBeenCalled()
    })

    it('should sync rules to Cloudflare', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Test Rule',
            description: 'Test Description',
            enabled: true,
            action: {
              type: 'deny',
            },
            conditions: [
              {
                field: 'path',
                operator: 'eq',
                value: '/test',
              },
            ],
          },
        ],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '2',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '3',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
      expect(result.version).toBe(3)
      expect(mockClient.updateRuleset).toHaveBeenCalledTimes(1)
    })

    // Regression test: syncRules previously reported `rulesAdded:
    // config.rules.length, rulesUpdated: 0, rulesDeleted: 0` unconditionally —
    // the actual write is a full-ruleset replace, but the *reported* stats
    // must reflect the real pre-sync diff, not just echo the local rule count.
    it('reports accurate add/update/delete counts from the actual diff, not config.rules.length', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-unchanged',
            name: 'Unchanged Rule',
            description: 'Unchanged',
            enabled: true,
            action: { type: 'deny' },
            conditions: [{ field: 'path', operator: 'eq', value: '/unchanged' }],
          },
          {
            id: 'rule-changed',
            name: 'Changed Rule',
            description: 'Changed',
            enabled: true,
            action: { type: 'deny' },
            conditions: [{ field: 'path', operator: 'eq', value: '/new-path' }],
          },
          {
            id: 'rule-new',
            name: 'New Rule',
            description: 'New',
            enabled: true,
            action: { type: 'deny' },
            conditions: [{ field: 'path', operator: 'eq', value: '/new' }],
          },
        ],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-unchanged',
            action: 'block',
            expression: 'http.request.uri.path eq "/unchanged"',
            description: 'Unchanged',
            enabled: true,
          },
          {
            id: 'rule-changed',
            action: 'block',
            expression: 'http.request.uri.path eq "/old-path"',
            description: 'Changed',
            enabled: true,
          },
          {
            id: 'rule-to-delete',
            action: 'block',
            expression: 'http.request.uri.path eq "/gone"',
            description: 'Will be deleted',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({ ...mockRuleset, version: '2' })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
      expect(result.rulesUpdated).toBe(1)
      expect(result.rulesDeleted).toBe(1)
    })

    // Regression test: the rule blocking IPs in the List
    // (`ip.src in $doorman_ip_blocklist`) was only added to the ruleset when
    // it appeared *absent* from the ruleset fetched *before* this sync. Since
    // the sync writes a brand-new `rules` array (full replace) rather than
    // appending to the existing one, that check against stale pre-sync state
    // meant sync #2 would see the rule "already there" from sync #1's
    // snapshot and omit it from the new array — silently dropping IP
    // blocking on the very next sync after it started working.
    it('keeps the IP-list block rule present across repeated syncs', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [{ id: 'ip-1', ip: '203.0.113.5', action: 'deny' }],
      }

      const listBlockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule_doorman_ip_list',
            action: 'block',
            expression: 'ip.src in $doorman_ip_blocklist',
            description: 'Block IPs in Doorman IP Blocklist',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(listBlockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 1,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest
        .spyOn(mockClient, 'getListItems')
        .mockResolvedValue([
          { id: 'item-1', ip: '203.0.113.5', created_on: '2024-01-01T00:00:00Z', modified_on: '2024-01-01T00:00:00Z' },
        ])
      const updateRulesetSpy = jest
        .spyOn(mockClient, 'updateRuleset')
        .mockResolvedValue({ ...listBlockRuleset, version: '2' })

      // Simulates the *second* sync: the ruleset the mock returns already
      // contains the list-block rule from a prior sync.
      await service.syncRules(mockConfig)

      const [, payload] = updateRulesetSpy.mock.calls[0]!
      expect(payload.rules?.some((r) => r.expression.includes('ip.src in $'))).toBe(true)
    })

    it('should sync IPs using Lists when account ID is provided', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-1',
            ip: '192.168.1.1',
            notes: 'Test IP',
            action: 'deny',
          },
          {
            id: 'ip-2',
            ip: '192.168.1.2',
            hostname: 'example.com',
            action: 'deny',
          },
        ],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])
      jest.spyOn(mockClient, 'addListItems').mockResolvedValue([])
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.ipsAdded).toBe(2)
      expect(mockClient.addListItems).toHaveBeenCalledWith('list-1', {
        items: [
          { ip: '192.168.1.1', comment: 'Test IP' },
          { ip: '192.168.1.2', comment: 'example.com' },
        ],
      })
    })

    it('should remove IPs no longer in config', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-1',
            ip: '192.168.1.1',
            action: 'deny',
          },
        ],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 2,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([
        {
          id: 'item-1',
          ip: '192.168.1.1',
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
        {
          id: 'item-2',
          ip: '192.168.1.2', // This one should be removed
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ])
      jest.spyOn(mockClient, 'removeListItems').mockResolvedValue(undefined)
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.ipsDeleted).toBe(1)
      expect(mockClient.removeListItems).toHaveBeenCalledWith('list-1', {
        items: [{ id: 'item-2' }],
      })
    })

    it('should fall back to individual IP rules if Lists API fails', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-1',
            ip: '192.168.1.1',
            action: 'deny',
          },
        ],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockRejectedValue(new Error('Lists API error'))
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.ipsAdded).toBe(1)
      // Should have used individual IP rules as fallback
    })

    // Regression test: a Lists API failure *after* addListItems already
    // succeeded previously fell back to creating individual rules for every
    // IP in config.ips — including ones already confirmed added to the List
    // — leaving them in both places (duplicate/inconsistent state) and
    // double-counting them in ipsAdded.
    it('does not create duplicate individual IP rules for IPs already confirmed in the List after a partial failure', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          { id: 'ip-1', ip: '192.168.1.1', action: 'deny' },
          { id: 'ip-2', ip: '192.168.1.2', action: 'deny' },
        ],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 1,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      // A stale item currently in the list (not in the desired config) forces
      // removeListItems to be called, which is where the failure happens —
      // *after* addListItems has already succeeded.
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([
        {
          id: 'stale-item',
          ip: '10.0.0.99',
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ])
      jest.spyOn(mockClient, 'addListItems').mockResolvedValue([])
      jest.spyOn(mockClient, 'removeListItems').mockRejectedValue(new Error('Lists API error during removal'))
      const updateRulesetSpy = jest
        .spyOn(mockClient, 'updateRuleset')
        .mockResolvedValue({ ...mockRuleset, version: '2' })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      // Both IPs were confirmed added to the List before removeListItems failed
      expect(result.ipsAdded).toBe(2)

      const [, payload] = updateRulesetSpy.mock.calls[0]!
      expect(payload.rules?.some((r) => r.expression.includes('192.168.1.1'))).toBe(false)
      expect(payload.rules?.some((r) => r.expression.includes('192.168.1.2'))).toBe(false)
    })

    it('should use individual IP rules when no account ID provided', async () => {
      const serviceWithoutAccount = new CloudflareFirewallService(API_TOKEN, ZONE_ID)
      const mockClientNoAccount = serviceWithoutAccount['client'] as jest.Mocked<CloudflareClient>

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-1',
            ip: '192.168.1.1',
            action: 'deny',
          },
        ],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClientNoAccount, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClientNoAccount, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })
      const getOrCreateIPBlocklistSpy = jest.spyOn(mockClientNoAccount, 'getOrCreateIPBlocklist')

      const result = await serviceWithoutAccount.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.ipsAdded).toBe(1)
      expect(getOrCreateIPBlocklistSpy).not.toHaveBeenCalled()
    })
  })

  describe('getChanges', () => {
    it('should detect rules to add', async () => {
      const localConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'New Rule',
            description: 'New rule to add',
            enabled: true,
            action: { type: 'deny' },
            conditions: [
              {
                field: 'path',
                operator: 'eq',
                value: '/test',
              },
            ],
          },
        ],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [], // No existing rules
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const changes = await service.getChanges(localConfig)

      expect(changes.rulesToAdd).toHaveLength(1)
      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.rulesToDelete).toHaveLength(0)
      expect(changes.hasChanges).toBe(true)
    })

    it('should detect IPs to add and delete', async () => {
      const localConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-new',
            ip: '192.168.1.100',
            action: 'deny',
          },
        ],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 1,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([
        {
          id: 'item-old',
          ip: '192.168.1.200', // Old IP to delete
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ])

      const changes = await service.getChanges(localConfig)

      expect(changes.ipsToAdd).toHaveLength(1)
      expect(changes.ipsToAdd?.[0]?.ip).toBe('192.168.1.100')
      expect(changes.ipsToDelete).toHaveLength(1)
      expect(changes.ipsToDelete?.[0]?.ip).toBe('192.168.1.200')
      expect(changes.hasChanges).toBe(true)
    })

    it('should detect no changes when configs match', async () => {
      // Use empty configs to test no changes scenario
      const localConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const changes = await service.getChanges(localConfig)

      expect(changes.rulesToAdd).toHaveLength(0)
      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.rulesToDelete).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    // Regression test: cloudflareToUnified always returns `conditions: []`
    // (expression parsing isn't implemented), so diffing in Unified space —
    // the old approach — meant a local rule with real conditions could never
    // match its remote counterpart: it showed as `toUpdate` forever, even
    // with nothing to sync. getChanges() now diffs in Cloudflare's native
    // space (comparing real wirefilter expressions) instead.
    it('detects no changes for a rule with real conditions that matches its remote Cloudflare counterpart', async () => {
      const localConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Existing Rule',
            description: 'Existing rule',
            enabled: true,
            action: { type: 'deny' },
            conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
          },
        ],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'http.request.uri.path eq "/test"',
            description: 'Existing rule',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)

      const changes = await service.getChanges(localConfig)

      expect(changes.rulesToAdd).toHaveLength(0)
      expect(changes.rulesToUpdate).toHaveLength(0)
      expect(changes.rulesToDelete).toHaveLength(0)
      expect(changes.hasChanges).toBe(false)
    })

    it('detects an update when the locally-translated expression differs from the remote rule', async () => {
      const localConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Existing Rule',
            description: 'Existing rule',
            enabled: true,
            action: { type: 'deny' },
            conditions: [{ field: 'path', operator: 'eq', value: '/new-path' }],
          },
        ],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'rule-1',
            action: 'block',
            expression: 'http.request.uri.path eq "/old-path"',
            description: 'Existing rule',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)

      const changes = await service.getChanges(localConfig)

      expect(changes.rulesToAdd).toHaveLength(0)
      expect(changes.rulesToUpdate).toHaveLength(1)
      expect(changes.rulesToDelete).toHaveLength(0)
      expect(changes.hasChanges).toBe(true)
    })
  })

  describe('getSupportedFeatures', () => {
    it('should return Cloudflare feature set', () => {
      const features = service.getSupportedFeatures()

      expect(features.supportsCustomRules).toBe(true)
      expect(features.supportsIPBlocking).toBe(true)
      expect(features.supportsRateLimiting).toBe(true)
      expect(features.supportsManagedRules).toBe(true)
      expect(features.supportsGeoBlocking).toBe(true)
      expect(features.supportsRedirect).toBe(true)
      expect(features.supportsChallenge).toBe(true)
      expect(features.maxRules).toBe(125)
    })
  })

  describe('validateConfig', () => {
    it('should validate basic config', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Test Rule',
            description: 'Test',
            enabled: true,
            action: { type: 'deny' },
            conditions: [
              {
                field: 'path',
                operator: 'eq',
                value: '/test',
              },
            ],
          },
        ],
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect rule count exceeding limit', () => {
      const rules: UnifiedRule[] = Array.from({ length: 130 }, (_, i) => ({
        id: `rule-${i}`,
        name: `Rule ${i}`,
        enabled: true,
        action: { type: 'deny' },
        conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
      }))

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules,
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6001')).toBe(true)
    })

    it('should detect missing conditions', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Invalid Rule',
            enabled: true,
            action: { type: 'deny' },
            conditions: [],
          },
        ],
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6007')).toBe(true)
    })

    it('should validate rate limiting configuration', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Rate Limit Rule',
            enabled: true,
            action: {
              type: 'rate_limit',
              rateLimit: {
                requests: 0, // Invalid: must be at least 1
                window: '60s',
              },
            },
            conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
          },
        ],
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6008')).toBe(true)
    })

    it('should validate rate limit window format', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Rate Limit Rule',
            enabled: true,
            action: {
              type: 'rate_limit',
              rateLimit: {
                requests: 100,
                window: 'invalid', // Invalid format
              },
            },
            conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
          },
        ],
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6009')).toBe(true)
    })

    it('should warn about short mitigation timeout', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Rate Limit Rule',
            enabled: true,
            action: {
              type: 'rate_limit',
              rateLimit: {
                requests: 100,
                window: '60s',
                mitigationTimeout: 30, // Less than 60 seconds
              },
            },
            conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
          },
        ],
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(true)
      expect(result.warnings.some((w) => w.code === 'CF_6010')).toBe(true)
    })

    it('should validate redirect configuration', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Redirect Rule',
            enabled: true,
            action: {
              type: 'redirect',
              redirect: {
                location: '', // Missing location
                statusCode: 302,
              },
            },
            conditions: [{ field: 'path', operator: 'eq', value: '/old' }],
          },
        ],
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6011')).toBe(true)
    })

    it('should validate IP address format', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-1',
            ip: 'invalid-ip', // Invalid IP
            action: 'deny',
          },
        ],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6013')).toBe(true)
    })

    it('accepts IPv6 addresses and CIDR ranges (regression test for #87)', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          { id: 'ip-1', ip: '2001:db8::1', action: 'deny' },
          { id: 'ip-2', ip: '2001:db8::/32', action: 'deny' },
          { id: 'ip-3', ip: '::1', action: 'deny' },
        ],
      }

      const result = service.validateConfig(config)

      expect(result.errors.some((e) => e.code === 'CF_6013')).toBe(false)
    })

    it('rejects an IPv6 CIDR with an out-of-range prefix length', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [{ id: 'ip-1', ip: '2001:db8::/129', action: 'deny' }],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6013')).toBe(true)
    })

    it('should warn about large IP lists without account ID', () => {
      const serviceWithoutAccount = new CloudflareFirewallService(API_TOKEN, ZONE_ID)

      const ips: UnifiedIPRule[] = Array.from({ length: 60 }, (_, i) => ({
        id: `ip-${i}`,
        ip: `192.168.1.${i}`,
        action: 'deny',
      }))

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips,
      }

      const result = serviceWithoutAccount.validateConfig(config)

      expect(result.valid).toBe(true)
      expect(result.warnings.some((w) => w.code === 'CF_6014')).toBe(true)
    })
  })

  describe('getHealthScore', () => {
    it('should return good health score for valid config', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Test Rule',
            description: 'Test Description',
            enabled: true,
            action: { type: 'deny' },
            conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
          },
        ],
        ips: [],
      }

      const healthScore = service.getHealthScore(config)

      expect(healthScore.score).toBeGreaterThan(70)
      expect(healthScore.grade).not.toBe('poor')
    })

    it('should warn when approaching rule limit', () => {
      const rules: UnifiedRule[] = Array.from({ length: 105 }, (_, i) => ({
        id: `rule-${i}`,
        name: `Rule ${i}`,
        description: 'Test',
        enabled: true,
        action: { type: 'deny' },
        conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
      }))

      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules,
        ips: [],
      }

      const healthScore = service.getHealthScore(config)

      expect(healthScore.issues.some((i) => i.category === 'limits')).toBe(true)
    })
  })

  describe('verifyCredentials', () => {
    it('should verify credentials using client', async () => {
      jest.spyOn(mockClient, 'verifyCredentials').mockResolvedValue(true)

      const result = await service.verifyCredentials()

      expect(result).toBe(true)
      expect(mockClient.verifyCredentials).toHaveBeenCalledTimes(1)
    })

    it('should return false for invalid credentials', async () => {
      jest.spyOn(mockClient, 'verifyCredentials').mockResolvedValue(false)

      const result = await service.verifyCredentials()

      expect(result).toBe(false)
    })
  })

  describe('Error Handling and Edge Cases', () => {
    it('should handle translation warnings during fetchConfig', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'complex-rule',
            action: 'managed_challenge',
            expression: 'http.request.uri.path contains "/admin" and ip.geoip.country eq "CN"',
            description: 'Complex rule with potential translation issues',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      expect(config.rules).toHaveLength(1)
      // Should handle complex rules without throwing
    })

    it('should handle malformed rules during fetchConfig', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'malformed-rule',
            action: 'block',
            expression: '', // Empty expression
            description: 'Malformed rule',
            enabled: true,
          },
          {
            id: 'valid-rule',
            action: 'allow',
            expression: 'http.request.uri.path eq "/valid"',
            description: 'Valid rule',
            enabled: true,
          },
        ],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      const config = await service.fetchConfig()

      // Should continue processing despite malformed rule
      expect(config.rules.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle network errors during sync', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockRejectedValue(new Error('Network timeout'))

      await expect(service.syncRules(mockConfig)).rejects.toThrow('Network timeout')
    })

    it('should handle partial sync failures gracefully', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-1',
            ip: '192.168.1.1',
            action: 'deny',
          },
        ],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockRejectedValue(new Error('Lists API temporarily unavailable'))
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      // Should fall back to individual IP rules
      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.ipsAdded).toBe(1)
    })

    it('should handle concurrent operations', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

      // Test concurrent fetchConfig calls
      const promises = Array.from({ length: 3 }, () => service.fetchConfig())
      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      results.forEach((config) => {
        expect(config.version).toBe('2.0')
        expect(config.provider).toBe('cloudflare')
      })
    })
  })

  describe('Complex Rule Scenarios', () => {
    it('should handle rate limiting rules with complex configurations', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rate-limit-rule',
            name: 'API Rate Limit',
            description: 'Rate limit API endpoints',
            enabled: true,
            action: {
              type: 'rate_limit',
              rateLimit: {
                requests: 100,
                window: '60s',
                characteristics: ['ip.src', 'http.request.uri.path'],
                mitigationTimeout: 300,
              },
            },
            conditions: [
              {
                field: 'path',
                operator: 'starts_with',
                value: '/api/',
              },
            ],
          },
        ],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
    })

    it('should handle redirect rules with various configurations', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'redirect-rule',
            name: 'Legacy Redirect',
            description: 'Redirect old paths',
            enabled: true,
            action: {
              type: 'redirect',
              redirect: {
                location: 'https://example.com/new-path',
                statusCode: 301,
              },
            },
            conditions: [
              {
                field: 'path',
                operator: 'eq',
                value: '/old-path',
              },
            ],
          },
        ],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
    })

    it('should handle geo-blocking rules', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'geo-block-rule',
            name: 'Block Specific Countries',
            description: 'Block traffic from specific countries',
            enabled: true,
            action: {
              type: 'deny',
            },
            conditions: [
              {
                field: 'country',
                operator: 'in',
                value: ['CN', 'RU', 'KP'],
              },
            ],
          },
        ],
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(1)
    })
  })

  describe('Large Scale Operations', () => {
    it('should handle large rule sets efficiently', async () => {
      const largeRuleSet: UnifiedRule[] = Array.from({ length: 100 }, (_, i) => ({
        id: `rule-${i}`,
        name: `Rule ${i}`,
        description: `Test rule ${i}`,
        enabled: true,
        action: { type: 'deny' },
        conditions: [
          {
            field: 'path',
            operator: 'eq',
            value: `/blocked-${i}`,
          },
        ],
      }))

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: largeRuleSet,
        ips: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.rulesAdded).toBe(100)
    })

    it('should handle large IP lists with Lists API', async () => {
      const largeIPList: UnifiedIPRule[] = Array.from({ length: 500 }, (_, i) => ({
        id: `ip-${i}`,
        ip: `192.168.${Math.floor(i / 256)}.${i % 256}`,
        action: 'deny',
        notes: `Blocked IP ${i}`,
      }))

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: largeIPList,
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(mockRuleset)
      jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue({
        id: 'list-1',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])
      jest.spyOn(mockClient, 'addListItems').mockResolvedValue([])
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.ipsAdded).toBe(500)
      expect(mockClient.addListItems).toHaveBeenCalled()
    })
  })

  describe('Configuration Validation Edge Cases', () => {
    it('should handle empty characteristics in rate limiting', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Rate Limit Rule',
            enabled: true,
            action: {
              type: 'rate_limit',
              rateLimit: {
                requests: 100,
                window: '60s',
                characteristics: [], // Empty characteristics
              },
            },
            conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
          },
        ],
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.warnings.some((w) => w.code === 'CF_6015')).toBe(true)
    })

    it('should validate CIDR notation in IP rules', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-1',
            ip: '192.168.1.0/24', // Valid CIDR
            action: 'deny',
          },
          {
            id: 'ip-2',
            ip: '10.0.0.0/8', // Valid CIDR
            action: 'deny',
          },
          {
            id: 'ip-3',
            ip: '192.168.1.1/33', // Invalid CIDR (subnet too large)
            action: 'deny',
          },
        ],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6013')).toBe(true)
    })

    it('should validate redirect URL formats', () => {
      const config: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'rule-1',
            name: 'Valid Redirect',
            enabled: true,
            action: {
              type: 'redirect',
              redirect: {
                location: 'https://example.com/valid',
                statusCode: 302,
              },
            },
            conditions: [{ field: 'path', operator: 'eq', value: '/old' }],
          },
          {
            id: 'rule-2',
            name: 'Invalid Redirect',
            enabled: true,
            action: {
              type: 'redirect',
              redirect: {
                location: 'not-a-valid-url',
                statusCode: 302,
              },
            },
            conditions: [{ field: 'path', operator: 'eq', value: '/old2' }],
          },
        ],
        ips: [],
      }

      const result = service.validateConfig(config)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CF_6012')).toBe(true)
    })
  })
})
