import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareFirewallService } from '../CloudflareFirewallService'
import { CloudflareClient } from '../CloudflareClient'
import { RuleTranslator } from '../../../translators/RuleTranslator'
import { TranslationWarningSystem } from '../../../translators/TranslationWarningSystem'
import type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from '../../../types/unified'
import type { CloudflareRuleset, CloudflareRule } from '../../../types/cloudflare'

// Mock operationSafety to bypass dry-run validation and confirmation prompts in tests
jest.mock('../../../utils/operationSafety', () => ({
  OperationSafety: {
    performDryRunValidation: jest.fn<any>().mockImplementation(async (_config: any, _op: any, validateFn: any) => {
      const changes = await validateFn(_config)
      return { valid: true, changes, issues: [] }
    }),
    confirmDestructiveOperation: jest.fn<any>().mockResolvedValue(true as any),
  },
}))

/**
 * Integration tests for Cloudflare workflows
 * Validates: Requirements 2.3, 2.6
 */

const API_TOKEN = 'test-token'
const ZONE_ID = 'test-zone-id'
const ACCOUNT_ID = 'test-account-id'

const createMockRuleset = (rules: CloudflareRule[] = [], version = '1'): CloudflareRuleset => ({
  id: 'ruleset-1',
  name: 'Doorman Custom Firewall Rules',
  description: 'Custom firewall rules managed by Doorman',
  kind: 'custom',
  phase: 'http_request_firewall_custom',
  version,
  last_updated: '2024-01-15T10:00:00Z',
  rules,
})

const createMockIPBlocklist = (numItems = 0) => ({
  id: 'list-1',
  name: 'Doorman IP Blocklist',
  description: 'IP addresses blocked by Doorman',
  kind: 'ip' as const,
  num_items: numItems,
  num_referencing_filters: numItems > 0 ? 1 : 0,
  created_on: '2024-01-01T00:00:00Z',
  modified_on: '2024-01-01T00:00:00Z',
})

// ── 1. Complete Sync Workflow (Requirement 2.6) ──────────────────────────

describe('Complete Sync Workflow Integration', () => {
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

  it('should complete a full fetch/diff/sync cycle', async () => {
    const remoteRules: CloudflareRule[] = [
      {
        id: 'existing-rule-1',
        action: 'block',
        expression: 'http.request.uri.path eq "/admin"',
        description: 'Block admin',
        enabled: true,
      },
    ]
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset(remoteRules, '3'))
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(1))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([
      {
        id: 'item-1',
        ip: '10.0.0.1',
        comment: 'Old IP',
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      },
    ])

    const remoteConfig = await service.fetchConfig()
    expect(remoteConfig.version).toBe('2.0')
    expect(remoteConfig.provider).toBe('cloudflare')
    expect(remoteConfig.rules.length).toBeGreaterThanOrEqual(1)
    expect(remoteConfig.ips).toHaveLength(1)
    expect(remoteConfig.metadata?.version).toBe(3)

    const localConfig: UnifiedConfig = {
      version: '2.0',
      provider: 'cloudflare',
      rules: [
        {
          id: 'new-rule-1',
          name: 'Block API abuse',
          description: 'Block suspicious API traffic',
          enabled: true,
          action: { type: 'deny' },
          conditions: [{ field: 'path', operator: 'starts_with', value: '/api/internal' }],
        },
      ],
      ips: [{ id: 'ip-new', ip: '192.168.1.50', action: 'deny', notes: 'New blocked IP' }],
    }

    const changes = await service.getChanges(localConfig)
    expect(changes.hasChanges).toBe(true)
    expect(changes.rulesToAdd.length).toBeGreaterThanOrEqual(1)
    expect(changes.ipsToAdd).toHaveLength(1)
    expect(changes.ipsToDelete).toHaveLength(1)

    jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue(createMockRuleset([], '4'))
    jest.spyOn(mockClient, 'addListItems').mockResolvedValue([])
    jest.spyOn(mockClient, 'removeListItems').mockResolvedValue(undefined)

    const syncResult = await service.syncRules(localConfig, { force: true })
    expect(syncResult.success).toBe(true)
    expect(syncResult.rulesAdded).toBe(1)
    expect(syncResult.ipsAdded).toBe(1)
    expect(syncResult.ipsDeleted).toBe(1)
    expect(mockClient.updateRuleset).toHaveBeenCalledTimes(1)
  })

  it('should handle sync with empty local config', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(
      createMockRuleset([
        {
          id: 'old',
          action: 'block',
          expression: 'http.request.uri.path eq "/old"',
          description: 'Old',
          enabled: true,
        },
      ]),
    )
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(0))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])
    jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue(createMockRuleset([], '2'))

    const result = await service.syncRules(
      { version: '2.0', provider: 'cloudflare', rules: [], ips: [] },
      { force: true },
    )
    expect(result.success).toBe(true)
    expect(result.rulesAdded).toBe(0)
    expect(mockClient.updateRuleset).toHaveBeenCalledWith('ruleset-1', { rules: [] })
  })

  it('should handle sync with mixed rule types', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset())
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(0))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])
    jest.spyOn(mockClient, 'addListItems').mockResolvedValue([])
    jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue(createMockRuleset([], '2'))

    const config: UnifiedConfig = {
      version: '2.0',
      provider: 'cloudflare',
      rules: [
        {
          id: 'path-rule',
          name: 'Block admin',
          enabled: true,
          action: { type: 'deny' },
          conditions: [{ field: 'path', operator: 'eq', value: '/admin' }],
        },
        {
          id: 'geo-rule',
          name: 'Challenge foreign',
          enabled: true,
          action: { type: 'challenge' },
          conditions: [{ field: 'country', operator: 'not_in', value: ['US', 'CA'] }],
        },
      ],
      ips: [
        { id: 'ip-1', ip: '10.0.0.1', action: 'deny', notes: 'Malicious' },
        { id: 'ip-2', ip: '10.0.0.2', action: 'deny', notes: 'Suspicious' },
      ],
    }
    const result = await service.syncRules(config, { force: true })
    expect(result.success).toBe(true)
    expect(result.rulesAdded).toBe(2)
    expect(result.ipsAdded).toBe(2)
  })

  it('should support dry-run mode without making changes', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset())
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(0))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])
    const updateSpy = jest.spyOn(mockClient, 'updateRuleset')

    const config: UnifiedConfig = {
      version: '2.0',
      provider: 'cloudflare',
      rules: [
        {
          id: 'rule-1',
          name: 'Test',
          enabled: true,
          action: { type: 'deny' },
          conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
        },
      ],
      ips: [],
    }
    const result = await service.syncRules(config, { dryRun: true })
    expect(result.success).toBe(true)
    expect(result.rulesAdded).toBe(1)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

// ── 2. Rule Translation Accuracy (Requirement 2.3) ──────────────────────

describe('Rule Translation Accuracy', () => {
  describe('Unified → Cloudflare', () => {
    it('should translate a deny rule with path condition', () => {
      const rule: UnifiedRule = {
        id: 'r1',
        name: 'Block admin',
        description: 'Block access',
        enabled: true,
        action: { type: 'deny' },
        conditions: [{ field: 'path', operator: 'eq', value: '/admin' }],
      }
      const result = RuleTranslator.unifiedToCloudflare(rule)
      expect(result.result.action).toBe('block')
      expect(result.result.expression).toContain('http.request.uri.path')
      expect(result.result.expression).toContain('"/admin"')
      expect(result.result.enabled).toBe(true)
    })

    it('should translate a challenge rule with geo condition', () => {
      const rule: UnifiedRule = {
        id: 'r2',
        name: 'Challenge non-US',
        enabled: true,
        action: { type: 'challenge' },
        conditions: [{ field: 'country', operator: 'not_in', value: ['US', 'CA', 'GB'] }],
      }
      const result = RuleTranslator.unifiedToCloudflare(rule)
      expect(result.result.action).toBe('managed_challenge')
      expect(result.result.expression).toContain('ip.geoip.country')
      expect(result.result.expression).toContain('not in')
    })

    it('should translate a rate limit rule with all parameters', () => {
      const rule: UnifiedRule = {
        id: 'r3',
        name: 'API rate limit',
        enabled: true,
        action: {
          type: 'rate_limit',
          rateLimit: {
            requests: 100,
            window: '60s',
            characteristics: ['ip.src', 'http.request.uri.path'],
            mitigationTimeout: 300,
            countingExpression: 'http.request.method eq "POST"',
          },
        },
        conditions: [{ field: 'path', operator: 'starts_with', value: '/api/' }],
      }
      const result = RuleTranslator.unifiedToCloudflare(rule)
      expect(result.result.action).toBe('block')
      expect(result.result.ratelimit?.requests_per_period).toBe(100)
      expect(result.result.ratelimit?.period).toBe(60)
      expect(result.result.ratelimit?.characteristics).toEqual(['ip.src', 'http.request.uri.path'])
      expect(result.result.ratelimit?.mitigation_timeout).toBe(300)
      expect(result.result.ratelimit?.counting_expression).toBe('http.request.method eq "POST"')
    })

    it('should translate an allow rule', () => {
      const rule: UnifiedRule = {
        id: 'r4',
        name: 'Allow health',
        enabled: true,
        action: { type: 'allow' },
        conditions: [{ field: 'path', operator: 'eq', value: '/health' }],
      }
      const result = RuleTranslator.unifiedToCloudflare(rule)
      expect(result.result.action).toBe('allow')
      expect(result.result.expression).toContain('"/health"')
    })

    it('should translate multiple AND conditions into a compound expression', () => {
      const rule: UnifiedRule = {
        id: 'r5',
        name: 'Complex',
        enabled: true,
        action: { type: 'deny' },
        conditionLogic: 'AND',
        conditions: [
          { field: 'path', operator: 'starts_with', value: '/api/' },
          { field: 'method', operator: 'eq', value: 'DELETE' },
        ],
      }
      const result = RuleTranslator.unifiedToCloudflare(rule)
      expect(result.result.expression).toContain('and')
      expect(result.result.expression).toContain('http.request.uri.path')
      expect(result.result.expression).toContain('http.request.method')
    })
  })

  describe('Cloudflare → Unified', () => {
    it('should translate a block rule to deny action', () => {
      const cfRule: CloudflareRule = {
        id: 'cf-1',
        action: 'block',
        expression: 'http.request.uri.path eq "/blocked"',
        description: 'Block path',
        enabled: true,
      }
      const result = RuleTranslator.cloudflareToUnified(cfRule)
      expect(result.result.action.type).toBe('deny')
      expect(result.result.name).toBe('Block path')
      expect(result.result.enabled).toBe(true)
    })

    it('should translate managed_challenge to challenge', () => {
      const cfRule: CloudflareRule = {
        id: 'cf-2',
        action: 'managed_challenge',
        expression: 'ip.geoip.country eq "CN"',
        description: 'Challenge China',
        enabled: true,
      }
      expect(RuleTranslator.cloudflareToUnified(cfRule).result.action.type).toBe('challenge')
    })

    it('should translate a rate limit rule preserving config', () => {
      const cfRule: CloudflareRule = {
        id: 'cf-rl',
        action: 'block',
        expression: 'http.request.uri.path starts_with "/api/"',
        description: 'Rate limit',
        enabled: true,
        ratelimit: {
          characteristics: ['ip.src'],
          period: 60,
          requests_per_period: 100,
          mitigation_timeout: 600,
          counting_expression: 'true',
        },
      }
      const rl = RuleTranslator.cloudflareToUnified(cfRule).result.action.rateLimit
      expect(rl).toBeDefined()
      expect(rl?.requests).toBe(100)
      expect(rl?.window).toBe('60s')
      expect(rl?.mitigationTimeout).toBe(600)
    })

    it('should produce warnings for complex expressions', () => {
      const cfRule: CloudflareRule = {
        id: 'cf-cx',
        action: 'block',
        expression: '(http.request.uri.path matches "^/api/.*") and (ip.geoip.country ne "US")',
        description: 'Complex',
        enabled: true,
      }
      const result = RuleTranslator.cloudflareToUnified(cfRule)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some((w: { category: string }) => w.category === 'lossy_conversion')).toBe(true)
    })
  })

  describe('Unified IP → Cloudflare', () => {
    it('should translate a deny IP rule to block expression', () => {
      const result = RuleTranslator.unifiedIPToCloudflare({
        id: 'ip-d',
        ip: '192.168.1.100',
        action: 'deny',
        notes: 'Malicious',
      })
      expect(result.action).toBe('block')
      expect(result.expression).toBe('ip.src eq 192.168.1.100')
    })

    it('should translate an allow IP rule', () => {
      const result = RuleTranslator.unifiedIPToCloudflare({
        id: 'ip-a',
        ip: '203.0.113.1',
        action: 'allow',
        hostname: 'trusted.example.com',
      })
      expect(result.action).toBe('allow')
      expect(result.expression).toBe('ip.src eq 203.0.113.1')
      expect(result.description).toContain('trusted.example.com')
    })
  })

  describe('Warning generation', () => {
    it('should generate warnings with proper severity levels', () => {
      const w = TranslationWarningSystem.createWarning('complex_expressions', 'test-rule', 'expression')
      expect(w.severity).toBe('warning')
      expect(w.category).toBe('lossy_conversion')
      expect(w.explanation).toBeTruthy()
    })

    it('should generate critical warnings for unsupported features', () => {
      const w = TranslationWarningSystem.createUnsupportedFeatureWarning(
        'managed_rules',
        'vercel',
        'cloudflare',
        'test-rule',
      )
      expect(w.severity).toBe('critical')
      expect(w.category).toBe('feature_unsupported')
    })

    it('should format warnings with icons and structured output', () => {
      const formatted = TranslationWarningSystem.formatWarning(
        TranslationWarningSystem.createWarning('regex_patterns', 'rule-1', 'path'),
      )
      expect(formatted).toContain('⚠️')
      expect(formatted).toContain('Rule: rule-1')
      expect(formatted).toContain('Suggestion:')
    })

    it('should group and summarize warnings correctly', () => {
      const warnings = [
        TranslationWarningSystem.createWarning('managed_rules'),
        TranslationWarningSystem.createWarning('complex_expressions'),
        TranslationWarningSystem.createWarning('rate_limiting_precision'),
      ]
      const grouped = TranslationWarningSystem.groupWarningsBySeverity(warnings)
      expect(grouped.critical.length).toBeGreaterThanOrEqual(1)
      expect(grouped.warning.length).toBeGreaterThanOrEqual(1)
      expect(grouped.info.length).toBeGreaterThanOrEqual(1)

      const summary = TranslationWarningSystem.getWarningSummary(warnings)
      expect(summary.total).toBe(3)
      expect(summary.hasBlockingIssues).toBe(true)
    })
  })
})

// ── 3. Error Recovery and Graceful Degradation ───────────────────────────

describe('Error Recovery and Graceful Degradation', () => {
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

  it('should fall back to individual IP rules when Lists API fails', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset())
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockRejectedValue(new Error('Account ID not found'))
    jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue(createMockRuleset([], '2'))

    const config: UnifiedConfig = {
      version: '2.0',
      provider: 'cloudflare',
      rules: [],
      ips: [
        { id: 'ip-1', ip: '10.0.0.1', action: 'deny' },
        { id: 'ip-2', ip: '10.0.0.2', action: 'deny' },
      ],
    }
    const result = await service.syncRules(config, { force: true })

    expect(result.success).toBe(true)
    expect(result.ipsAdded).toBe(2)
    const updateCall = (mockClient.updateRuleset as jest.Mock).mock.calls[0] as [string, { rules: CloudflareRule[] }]
    expect(updateCall[1].rules.some((r: CloudflareRule) => r.expression.includes('10.0.0.1'))).toBe(true)
    expect(updateCall[1].rules.some((r: CloudflareRule) => r.expression.includes('10.0.0.2'))).toBe(true)
  })

  it('should fall back on permission error', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset())
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockRejectedValue(new Error('Forbidden: insufficient permissions'))
    jest.spyOn(mockClient, 'updateRuleset').mockResolvedValue(createMockRuleset([], '2'))

    const result = await service.syncRules(
      { version: '2.0', provider: 'cloudflare', rules: [], ips: [{ id: 'ip-1', ip: '10.0.0.1', action: 'deny' }] },
      { force: true },
    )
    expect(result.success).toBe(true)
    expect(result.ipsAdded).toBe(1)
  })

  it('should work without account ID using individual IP rules', async () => {
    const svc = new CloudflareFirewallService(API_TOKEN, ZONE_ID)
    const cl = svc['client']
    jest.spyOn(cl, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset())
    jest.spyOn(cl, 'updateRuleset').mockResolvedValue(createMockRuleset([], '2'))
    const blocklistSpy = jest.spyOn(cl, 'getOrCreateIPBlocklist')

    const result = await svc.syncRules(
      { version: '2.0', provider: 'cloudflare', rules: [], ips: [{ id: 'ip-1', ip: '10.0.0.1', action: 'deny' }] },
      { force: true },
    )
    expect(result.success).toBe(true)
    expect(result.ipsAdded).toBe(1)
    expect(blocklistSpy).not.toHaveBeenCalled()
  })

  it('should continue fetching config when Lists API fails', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(
      createMockRuleset([
        {
          id: 'r1',
          action: 'block',
          expression: 'http.request.uri.path eq "/blocked"',
          description: 'Block',
          enabled: true,
        },
      ]),
    )
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockRejectedValue(new Error('Lists API unavailable'))

    const config = await service.fetchConfig()
    expect(config.rules.length).toBeGreaterThanOrEqual(1)
    expect(config.ips).toHaveLength(0)
  })

  it('should throw when ruleset fetch fails', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockRejectedValue(new Error('Network connection failed'))
    await expect(service.fetchConfig()).rejects.toThrow()
  })

  it('should throw when ruleset update fails during sync', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset())
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(0))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])
    jest.spyOn(mockClient, 'updateRuleset').mockRejectedValue(new Error('API timeout'))

    const config: UnifiedConfig = {
      version: '2.0',
      provider: 'cloudflare',
      rules: [
        {
          id: 'r1',
          name: 'Test',
          enabled: true,
          action: { type: 'deny' },
          conditions: [{ field: 'path', operator: 'eq', value: '/test' }],
        },
      ],
      ips: [],
    }
    await expect(service.syncRules(config, { force: true })).rejects.toThrow()
  })

  it('should skip malformed rules and continue', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(
      createMockRuleset([
        {
          id: 'valid',
          action: 'block',
          expression: 'http.request.uri.path eq "/valid"',
          description: 'Valid',
          enabled: true,
        },
        { id: '', action: 'block', expression: '', description: 'Malformed', enabled: true },
        {
          id: 'valid2',
          action: 'allow',
          expression: 'http.request.uri.path eq "/health"',
          description: 'Valid2',
          enabled: true,
        },
      ]),
    )
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(0))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

    const config = await service.fetchConfig()
    expect(config.rules.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle empty ruleset gracefully', async () => {
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset([]))
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(0))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

    const config = await service.fetchConfig()
    expect(config.rules).toHaveLength(0)
    expect(config.ips).toHaveLength(0)
    expect(config.version).toBe('2.0')
  })

  it('should detect invalid IP addresses', () => {
    const result = service.validateConfig({
      version: '2.0',
      provider: 'cloudflare',
      rules: [],
      ips: [{ id: 'bad', ip: 'not-an-ip', action: 'deny' }],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should detect rules without conditions', () => {
    const result = service.validateConfig({
      version: '2.0',
      provider: 'cloudflare',
      rules: [{ id: 'nc', name: 'No cond', enabled: true, action: { type: 'deny' }, conditions: [] }],
      ips: [],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should detect rule count exceeding limits', () => {
    const rules: UnifiedRule[] = Array.from({ length: 130 }, (_, i) => ({
      id: `r-${i}`,
      name: `R ${i}`,
      enabled: true,
      action: { type: 'deny' as const },
      conditions: [{ field: 'path', operator: 'eq' as const, value: `/p-${i}` }],
    }))
    const result = service.validateConfig({ version: '2.0', provider: 'cloudflare', rules, ips: [] })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// ── 4. Performance Baselines ─────────────────────────────────────────────

describe('Performance Baselines', () => {
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

  it('should translate 50 rules in under 500ms', () => {
    const rules: UnifiedRule[] = Array.from({ length: 50 }, (_, i) => ({
      id: `r-${i}`,
      name: `R ${i}`,
      description: `Test ${i}`,
      enabled: true,
      action: { type: 'deny' as const },
      conditions: [{ field: 'path', operator: 'eq' as const, value: `/p-${i}` }],
    }))
    const start = Date.now()
    const results = rules.map((r) => RuleTranslator.unifiedToCloudflare(r))
    const elapsed = Date.now() - start
    expect(results).toHaveLength(50)
    results.forEach((r) => {
      expect(r.result.action).toBe('block')
      expect(r.result.expression).toBeTruthy()
    })
    expect(elapsed).toBeLessThan(500)
  })

  it('should validate a typical config (30 rules, 20 IPs) in under 200ms', () => {
    const rules: UnifiedRule[] = Array.from({ length: 30 }, (_, i) => ({
      id: `r-${i}`,
      name: `R ${i}`,
      enabled: true,
      action: { type: 'deny' as const },
      conditions: [{ field: 'path', operator: 'eq' as const, value: `/p-${i}` }],
    }))
    const ips: UnifiedIPRule[] = Array.from({ length: 20 }, (_, i) => ({
      id: `ip-${i}`,
      ip: `192.168.1.${i + 1}`,
      action: 'deny' as const,
    }))
    const start = Date.now()
    const result = service.validateConfig({ version: '2.0', provider: 'cloudflare', rules, ips })
    const elapsed = Date.now() - start
    expect(result.valid).toBe(true)
    expect(elapsed).toBeLessThan(200)
  })

  it('should compute diff for 50 rules in under 500ms', async () => {
    const localRules: UnifiedRule[] = Array.from({ length: 50 }, (_, i) => ({
      id: `r-${i}`,
      name: `R ${i}`,
      enabled: true,
      action: { type: 'deny' as const },
      conditions: [{ field: 'path', operator: 'eq' as const, value: `/p-${i}` }],
    }))
    const remoteRules: CloudflareRule[] = Array.from({ length: 50 }, (_, i) => ({
      id: i < 40 ? `r-${i}` : `remote-${i}`,
      action: 'block' as const,
      expression: `http.request.uri.path eq "/p-${i < 40 ? i : i + 100}"`,
      description: `R ${i}`,
      enabled: true,
    }))

    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset(remoteRules))
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(0))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

    const start = Date.now()
    const changes = await service.getChanges({ version: '2.0', provider: 'cloudflare', rules: localRules, ips: [] })
    const elapsed = Date.now() - start
    expect(changes.hasChanges).toBe(true)
    expect(elapsed).toBeLessThan(500)
  })

  it('should fetch config with 100 rules in under 1000ms', async () => {
    const largeRules: CloudflareRule[] = Array.from({ length: 100 }, (_, i) => ({
      id: `r-${i}`,
      action: 'block' as const,
      expression: `http.request.uri.path eq "/p-${i}"`,
      description: `R ${i}`,
      enabled: true,
    }))
    jest.spyOn(mockClient, 'getOrCreateFirewallRuleset').mockResolvedValue(createMockRuleset(largeRules))
    jest.spyOn(mockClient, 'getOrCreateIPBlocklist').mockResolvedValue(createMockIPBlocklist(0))
    jest.spyOn(mockClient, 'getListItems').mockResolvedValue([])

    const start = Date.now()
    const config = await service.fetchConfig()
    const elapsed = Date.now() - start
    expect(config.rules.length).toBe(100)
    expect(elapsed).toBeLessThan(1000)
  })
})
