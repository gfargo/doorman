import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareFirewallService } from '../CloudflareFirewallService'
import { CloudflareClient } from '../CloudflareClient'
import type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from '../../../types/unified'
import type { CloudflareRuleset } from '../../../types/cloudflare'

// Mock logger
jest.mock('../../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// Mock OperationSafety for syncRules tests
jest.mock('../../../utils/operationSafety', () => ({
  OperationSafety: {
    performDryRunValidation: jest.fn<() => Promise<any>>().mockResolvedValue({
      valid: true,
      changes: {
        rulesToAdd: [],
        rulesToUpdate: [],
        rulesToDelete: [],
        ipsToAdd: [],
        ipsToUpdate: [],
        ipsToDelete: [],
        hasChanges: false,
      },
      issues: [],
    }),
    confirmDestructiveOperation: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    assessOperationRisk: jest.fn<() => 'low' | 'medium' | 'high'>().mockReturnValue('low'),
  },
}))

describe('Cloudflare Rule Scenarios', () => {
  const API_TOKEN = 'test-token'
  const ZONE_ID = 'test-zone-id'
  const ACCOUNT_ID = 'test-account-id'

  let service: CloudflareFirewallService
  let mockClient: CloudflareClient

  beforeEach(() => {
    jest.clearAllMocks()
    service = new CloudflareFirewallService(API_TOKEN, ZONE_ID, ACCOUNT_ID)
    mockClient = service['client']
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Complex Rule Translation', () => {
    it('should handle rate limiting rules with all parameters', async () => {
      const rateLimitRule: UnifiedRule = {
        id: 'rate-limit-complex',
        name: 'Complex Rate Limit',
        description: 'Rate limit with all parameters',
        enabled: true,
        action: {
          type: 'rate_limit',
          rateLimit: {
            requests: 100,
            window: '60s',
            characteristics: ['ip.src', 'http.request.uri.path', 'http.request.headers["user-agent"]'],
            mitigationTimeout: 300,
            countingExpression: 'http.request.method eq "POST"',
          },
        },
        conditions: [
          {
            field: 'path',
            operator: 'starts_with',
            value: '/api/',
          },
          {
            field: 'method',
            operator: 'eq',
            value: 'POST',
          },
        ],
      }

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [rateLimitRule],
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
      expect(mockClient.updateRuleset).toHaveBeenCalledWith(
        'ruleset-1',
        expect.objectContaining({
          rules: expect.arrayContaining([
            expect.objectContaining({
              action: 'block',
              ratelimit: expect.objectContaining({
                requests_per_period: 100,
                period: 60,
              }),
            }),
          ]),
        }),
      )
    })

    it('should handle redirect rules with various configurations', async () => {
      const redirectRules: UnifiedRule[] = [
        {
          id: 'redirect-301',
          name: 'Permanent Redirect',
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
        {
          id: 'redirect-302',
          name: 'Temporary Redirect',
          enabled: true,
          action: {
            type: 'redirect',
            redirect: {
              location: '/new-relative-path',
              statusCode: 302,
            },
          },
          conditions: [
            {
              field: 'path',
              operator: 'starts_with',
              value: '/legacy/',
            },
          ],
        },
      ]

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: redirectRules,
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
      expect(result.rulesAdded).toBe(2)
    })

    it('should handle geo-blocking rules with multiple countries', async () => {
      const geoBlockRule: UnifiedRule = {
        id: 'geo-block-multiple',
        name: 'Block Multiple Countries',
        description: 'Block traffic from specific countries',
        enabled: true,
        action: {
          type: 'deny',
        },
        conditions: [
          {
            field: 'country',
            operator: 'in',
            value: ['CN', 'RU', 'KP', 'IR'],
          },
        ],
      }

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [geoBlockRule],
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

    it('should handle challenge rules with different types', async () => {
      const challengeRules: UnifiedRule[] = [
        {
          id: 'js-challenge',
          name: 'JavaScript Challenge',
          enabled: true,
          action: {
            type: 'challenge',
          },
          conditions: [
            {
              field: 'user_agent',
              operator: 'contains',
              value: 'bot',
            },
          ],
        },
        {
          id: 'managed-challenge',
          name: 'Managed Challenge',
          enabled: true,
          action: {
            type: 'challenge',
          },
          conditions: [
            {
              field: 'threat_score',
              operator: 'gt',
              value: 50,
            },
          ],
        },
      ]

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: challengeRules,
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
      expect(result.rulesAdded).toBe(2)
    })
  })

  describe('Complex Condition Scenarios', () => {
    it('should handle multiple conditions with different operators', async () => {
      const complexRule: UnifiedRule = {
        id: 'complex-conditions',
        name: 'Complex Conditions Rule',
        enabled: true,
        action: {
          type: 'deny',
        },
        conditions: [
          {
            field: 'path',
            operator: 'starts_with',
            value: '/admin',
          },
          {
            field: 'country',
            operator: 'not_in',
            value: ['US', 'CA', 'GB'],
          },
          {
            field: 'user_agent',
            operator: 'not_contains',
            value: 'legitimate-bot',
          },
          {
            field: 'ip',
            operator: 'ne',
            value: '192.168.0.0/16',
          },
        ],
      }

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [complexRule],
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

    it('should handle regex patterns in conditions', async () => {
      const regexRule: UnifiedRule = {
        id: 'regex-rule',
        name: 'Regex Pattern Rule',
        enabled: true,
        action: {
          type: 'deny',
        },
        conditions: [
          {
            field: 'path',
            operator: 'matches',
            value: '^/api/v[0-9]+/.*',
          },
          {
            field: 'user_agent',
            operator: 'matches',
            value: '.*(bot|crawler|spider).*',
          },
        ],
      }

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [regexRule],
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

    it('should handle header-based conditions', async () => {
      const headerRule: UnifiedRule = {
        id: 'header-rule',
        name: 'Header-based Rule',
        enabled: true,
        action: {
          type: 'challenge',
        },
        conditions: [
          {
            field: 'header',
            operator: 'eq',
            value: 'X-Forwarded-For: suspicious-proxy',
          },
          {
            field: 'header',
            operator: 'not_exists',
            value: 'X-Real-IP',
          },
        ],
      }

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [headerRule],
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

  describe('IP Rule Scenarios', () => {
    it('should handle mixed IP and CIDR rules', async () => {
      const ipRules: UnifiedIPRule[] = [
        {
          id: 'single-ip',
          ip: '192.168.1.100',
          action: 'deny',
          notes: 'Malicious IP',
        },
        {
          id: 'cidr-range',
          ip: '10.0.0.0/8',
          action: 'deny',
          notes: 'Private network range',
        },
        {
          id: 'ipv6-address',
          ip: '2001:db8::1',
          action: 'deny',
          notes: 'IPv6 test address',
        },
        {
          id: 'allowed-ip',
          ip: '203.0.113.1',
          action: 'allow',
          notes: 'Whitelisted IP',
        },
      ]

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: ipRules,
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
      expect(result.ipsAdded).toBe(4)
    })

    it('should handle large IP lists efficiently with batching', async () => {
      const largeIPList: UnifiedIPRule[] = Array.from({ length: 1000 }, (_, i) => ({
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
      expect(result.ipsAdded).toBe(1000)
      expect(mockClient.addListItems).toHaveBeenCalled()
    })

    it('should handle IP list updates and deletions', async () => {
      const updatedIPList: UnifiedIPRule[] = [
        {
          id: 'ip-keep',
          ip: '192.168.1.1',
          action: 'deny',
          notes: 'Keep this IP',
        },
        {
          id: 'ip-new',
          ip: '192.168.1.2',
          action: 'deny',
          notes: 'New IP to add',
        },
      ]

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: updatedIPList,
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
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([
        {
          id: 'item-keep',
          ip: '192.168.1.1',
          comment: 'Keep this IP',
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
        {
          id: 'item-remove',
          ip: '192.168.1.100', // This should be removed
          comment: 'Remove this IP',
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ])
      jest.spyOn(mockClient, 'addListItems').mockResolvedValue([])
      jest.spyOn(mockClient, 'removeListItems').mockResolvedValue(undefined)
      jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue({
        ...mockRuleset,
        version: '2',
      })

      const result = await service.syncRules(mockConfig)

      expect(result.success).toBe(true)
      expect(result.ipsAdded).toBe(1) // New IP
      expect(result.ipsDeleted).toBe(1) // Removed IP
      expect(mockClient.addListItems).toHaveBeenCalledWith('list-1', {
        items: [{ ip: '192.168.1.2', comment: 'New IP to add' }],
      })
      expect(mockClient.removeListItems).toHaveBeenCalledWith('list-1', {
        items: [{ id: 'item-remove' }],
      })
    })
  })

  describe('Rule Fetching and Translation', () => {
    it('should correctly identify and parse List-based IP rules', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'list-rule',
            action: 'block',
            expression: 'ip.src in $doorman_ip_blocklist',
            description: 'Block IPs in Doorman IP Blocklist',
            enabled: true,
          },
          {
            id: 'regular-rule',
            action: 'allow',
            expression: 'http.request.uri.path eq "/health"',
            description: 'Allow health checks',
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

      expect(config.rules).toHaveLength(1) // Only the regular rule, not the list rule
      expect(config.ips).toHaveLength(2) // IPs from the list
      expect(config.rules[0]?.id).toBe('regular-rule')
      expect(config.ips?.[0]?.ip).toBe('192.168.1.1')
      expect(config.ips?.[1]?.ip).toBe('192.168.1.2')
    })

    it('should correctly identify and parse individual IP rules', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'ip-rule-1',
            action: 'block',
            expression: 'ip.src eq 192.168.1.100',
            description: 'Block specific IP (malicious.com)',
            enabled: true,
          },
          {
            id: 'ip-rule-2',
            action: 'allow',
            expression: 'ip.src eq 203.0.113.1',
            description: 'Allow trusted IP',
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

      expect(config.rules).toHaveLength(0) // IP rules are converted to IP entries
      expect(config.ips).toHaveLength(2)
      expect(config.ips?.[0]?.ip).toBe('192.168.1.100')
      expect(config.ips?.[0]?.hostname).toBe('malicious.com')
      expect(config.ips?.[0]?.action).toBe('deny')
      expect(config.ips?.[1]?.ip).toBe('203.0.113.1')
      expect(config.ips?.[1]?.action).toBe('allow')
    })

    it('should handle mixed rule types in a single ruleset', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Mixed Ruleset',
        description: 'Ruleset with various rule types',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'path-rule',
            action: 'block',
            expression: 'http.request.uri.path eq "/admin"',
            description: 'Block admin path',
            enabled: true,
          },
          {
            id: 'ip-rule',
            action: 'block',
            expression: 'ip.src eq 192.168.1.100',
            description: 'Block specific IP',
            enabled: true,
          },
          {
            id: 'list-rule',
            action: 'block',
            expression: 'ip.src in $doorman_ip_blocklist',
            description: 'Block IPs in list',
            enabled: true,
          },
          {
            id: 'geo-rule',
            action: 'challenge',
            expression: 'ip.geoip.country eq "CN"',
            description: 'Challenge China traffic',
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
        num_items: 1,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      })
      jest.spyOn(mockClient, 'getListItems').mockResolvedValue([
        {
          id: 'list-item-1',
          ip: '10.0.0.1',
          comment: 'List IP',
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ])

      const config = await service.fetchConfig()

      expect(config.rules).toHaveLength(2) // path-rule and geo-rule
      expect(config.ips).toHaveLength(2) // ip-rule and list item

      // Check that rules are properly categorized
      const pathRule = config.rules.find((r) => r.id === 'path-rule')
      const geoRule = config.rules.find((r) => r.id === 'geo-rule')
      expect(pathRule).toBeDefined()
      expect(geoRule).toBeDefined()

      // Check that IPs are properly extracted
      const individualIP = config.ips?.find((ip) => ip.ip === '192.168.1.100')
      const listIP = config.ips?.find((ip) => ip.ip === '10.0.0.1')
      expect(individualIP).toBeDefined()
      expect(listIP).toBeDefined()
    })
  })

  describe('Error Handling in Rule Processing', () => {
    it('should continue processing rules when one rule fails translation', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [
          {
            id: 'valid-rule',
            action: 'block',
            expression: 'http.request.uri.path eq "/valid"',
            description: 'Valid rule',
            enabled: true,
          },
          {
            id: 'invalid-rule',
            action: 'unknown_action' as any,
            expression: '', // Empty expression
            description: 'Invalid rule',
            enabled: true,
          },
          {
            id: 'another-valid-rule',
            action: 'allow',
            expression: 'http.request.uri.path eq "/allowed"',
            description: 'Another valid rule',
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

      // Should continue processing despite the invalid rule
      expect(config.rules.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle empty rulesets gracefully', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'empty-ruleset',
        name: 'Empty Ruleset',
        description: 'Ruleset with no rules',
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

      const config = await service.fetchConfig()

      expect(config.rules).toHaveLength(0)
      expect(config.ips).toHaveLength(0)
      expect(config.version).toBe('2.0')
      expect(config.provider).toBe('cloudflare')
    })
  })
})
