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

    it('should include version from remote config', async () => {
      jest.spyOn(client, 'fetchFirewallConfig').mockResolvedValue(mockVercelConfig)

      const changes = await service.getChanges(unifiedConfig)

      expect(changes.version).toBe(mockVercelConfig.version)
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
