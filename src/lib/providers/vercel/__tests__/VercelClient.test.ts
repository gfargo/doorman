import { VercelClient, VERCEL_API_BASE_URL } from '../VercelClient'
import type { CustomRule, IPBlockingRule } from '../../../types/vercel'

// Mock the logger
jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// Mock the prompt module
jest.mock('../../../ui/prompt', () => ({
  prompt: jest.fn().mockResolvedValue(false),
}))

import { prompt } from '../../../ui/prompt'

describe('VercelClient', () => {
  const projectId = 'proj_123'
  const teamId = 'team_456'
  const token = 'test-token-abc'
  let client: VercelClient
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    client = new VercelClient(projectId, teamId, token)
    // Mock the delay method to avoid real timeouts
    jest.spyOn(client as any, 'delay').mockResolvedValue(undefined)
    fetchSpy = jest.spyOn(globalThis, 'fetch')
    jest.clearAllMocks()
    // Re-mock delay after clearAllMocks
    jest.spyOn(client as any, 'delay').mockResolvedValue(undefined)
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  const mockVercelConfig = {
    active: {
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
              conditions: [{ type: 'user_agent', op: 'sub', value: 'BadBot' }],
            },
          ],
          action: {
            mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null },
          },
        },
      ],
      ips: [{ id: 'ip_1', ip: '1.2.3.4', hostname: 'example.com', action: 'deny', notes: 'test' }],
      projectKey: 'pk_123',
      ownerId: 'owner_1',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  }

  function createMockResponse(body: unknown, status = 200, statusText = 'OK'): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: new Headers(),
      json: jest.fn().mockResolvedValue(body),
      text: jest.fn().mockResolvedValue(JSON.stringify(body)),
      clone: jest.fn(),
    } as unknown as Response
  }

  describe('fetchFirewallConfig', () => {
    it('should fetch the latest firewall config', async () => {
      fetchSpy.mockResolvedValue(createMockResponse(mockVercelConfig))

      const result = await client.fetchFirewallConfig()

      expect(result).toEqual(mockVercelConfig.active)
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(VERCEL_API_BASE_URL),
        expect.objectContaining({
          method: 'GET',
        }),
      )
    })

    it('should include projectId and teamId in URL', async () => {
      fetchSpy.mockResolvedValue(createMockResponse(mockVercelConfig))

      await client.fetchFirewallConfig()

      const calledUrl = fetchSpy.mock.calls[0]![0] as string
      expect(calledUrl).toContain(`projectId=${projectId}`)
      expect(calledUrl).toContain(`teamId=${teamId}`)
    })

    it('should fetch a specific config version', async () => {
      const versionConfig = { ...mockVercelConfig.active, version: 5 }
      fetchSpy.mockResolvedValue(createMockResponse(versionConfig))

      const result = await client.fetchFirewallConfig(5)

      expect(result).toEqual(versionConfig)
      const calledUrl = fetchSpy.mock.calls[0]![0] as string
      expect(calledUrl).toContain(`${VERCEL_API_BASE_URL}/5`)
    })

    it('should include authorization header with token', async () => {
      fetchSpy.mockResolvedValue(createMockResponse(mockVercelConfig))

      await client.fetchFirewallConfig()

      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      expect(calledOptions.headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${token}`,
        }),
      )
    })

    it('should handle API errors', async () => {
      fetchSpy.mockResolvedValue(createMockResponse({ error: 'Unauthorized' }, 401, 'Unauthorized'))

      await expect(client.fetchFirewallConfig()).rejects.toThrow()
    })

    describe('when no firewall configuration exists yet (active: null)', () => {
      it('prompts to create one by default (allowCreate defaults to true)', async () => {
        fetchSpy.mockResolvedValue(createMockResponse({ active: null }))
        ;(prompt as jest.Mock).mockResolvedValueOnce(false)

        const result = await client.fetchFirewallConfig()

        expect(prompt).toHaveBeenCalledWith('Would you like to create one?', { type: 'confirm' })
        expect(result).toBeNull()
      })

      it('creates an empty config when the user confirms the prompt (allowCreate defaults to true)', async () => {
        fetchSpy
          .mockResolvedValueOnce(createMockResponse({ active: null }))
          .mockResolvedValueOnce(createMockResponse(mockVercelConfig))
        ;(prompt as jest.Mock).mockResolvedValueOnce(true)

        const result = await client.fetchFirewallConfig()

        expect(prompt).toHaveBeenCalled()
        // putEmptyConfig() issues the mutating PUT — verify it actually fired.
        expect(fetchSpy).toHaveBeenCalledTimes(2)
        expect(fetchSpy.mock.calls[1]![1]).toEqual(expect.objectContaining({ method: 'PUT' }))
        expect(result).toEqual(mockVercelConfig.active)
      })

      it('never prompts or mutates when allowCreate is false, and returns a synthetic empty config instead', async () => {
        fetchSpy.mockResolvedValue(createMockResponse({ active: null }))

        const result = await client.fetchFirewallConfig(undefined, { allowCreate: false })

        expect(prompt).not.toHaveBeenCalled()
        // Only the initial GET should have fired — no follow-up PUT.
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(result.rules).toEqual([])
        expect(result.ips).toEqual([])
      })
    })
  })

  describe('updateFirewallRule', () => {
    const rule: CustomRule = {
      id: 'rule_1',
      name: 'Test Rule',
      description: 'A test rule',
      active: true,
      conditionGroup: [
        {
          conditions: [{ type: 'path', op: 'eq', value: '/admin' }],
        },
      ],
      action: {
        mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null },
      },
    }

    it('should update an existing rule', async () => {
      fetchSpy.mockResolvedValue(createMockResponse(rule))

      const result = await client.updateFirewallRule(rule)

      expect(result).toEqual(rule)
      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(calledOptions.body as string)
      expect(body.action).toBe('rules.update')
      expect(body.id).toBe('rule_1')
    })

    it('should create a new rule when id is "-"', async () => {
      const newRule = { ...rule, id: '-' }
      fetchSpy.mockResolvedValue(createMockResponse({ ...rule, id: 'new_rule_1' }))

      await client.updateFirewallRule(newRule)

      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(calledOptions.body as string)
      expect(body.action).toBe('rules.insert')
      expect(body.id).toBeNull()
    })

    it('should handle errors', async () => {
      fetchSpy.mockResolvedValue(createMockResponse({ error: 'Bad Request' }, 400, 'Bad Request'))

      await expect(client.updateFirewallRule(rule)).rejects.toThrow()
    })
  })

  describe('createFirewallRule', () => {
    it('should create a rule with id set to "-"', async () => {
      const ruleWithoutId = {
        name: 'New Rule',
        description: 'A new rule',
        active: true,
        conditionGroup: [{ conditions: [{ type: 'path' as const, op: 'eq' as const, value: '/test' }] }],
        action: {
          mitigate: { action: 'deny' as const, rateLimit: null, redirect: null, actionDuration: null },
        },
      }

      fetchSpy.mockResolvedValue(createMockResponse({ ...ruleWithoutId, id: 'created_rule_1' }))

      await client.createFirewallRule(ruleWithoutId)

      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(calledOptions.body as string)
      expect(body.action).toBe('rules.insert')
    })
  })

  describe('deleteFirewallRule', () => {
    it('should delete a rule', async () => {
      const rule: CustomRule = {
        id: 'rule_to_delete',
        name: 'Delete me',
        active: true,
        conditionGroup: [],
        action: { mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null } },
      }

      fetchSpy.mockResolvedValue(createMockResponse({}))

      await client.deleteFirewallRule(rule)

      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(calledOptions.body as string)
      expect(body.action).toBe('rules.remove')
      expect(body.id).toBe('rule_to_delete')
      expect(body.value).toBeNull()
    })
  })

  describe('IP blocking rules', () => {
    const ipRule: IPBlockingRule = {
      id: 'ip_1',
      ip: '10.0.0.1',
      hostname: 'example.com',
      action: 'deny',
      notes: 'Blocked',
    }

    it('should update an existing IP blocking rule', async () => {
      fetchSpy.mockResolvedValue(createMockResponse(ipRule))

      await client.updateIPBlockingRule(ipRule)

      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(calledOptions.body as string)
      expect(body.action).toBe('ip.update')
      expect(body.id).toBe('ip_1')
    })

    it('should create a new IP blocking rule when id is "-"', async () => {
      const newIpRule = { ...ipRule, id: '-' }
      fetchSpy.mockResolvedValue(createMockResponse({ ...ipRule, id: 'new_ip_1' }))

      await client.updateIPBlockingRule(newIpRule)

      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(calledOptions.body as string)
      expect(body.action).toBe('ip.insert')
      expect(body.id).toBeNull()
    })

    it('should create an IP blocking rule via createIPBlockingRule', async () => {
      const ruleWithoutId = {
        ip: '10.0.0.2',
        hostname: 'test.com',
        action: 'deny' as const,
        notes: 'New block',
      }

      fetchSpy.mockResolvedValue(createMockResponse({ ...ruleWithoutId, id: 'created_ip_1' }))

      await client.createIPBlockingRule(ruleWithoutId)

      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(calledOptions.body as string)
      expect(body.action).toBe('ip.insert')
    })

    it('should delete an IP blocking rule', async () => {
      fetchSpy.mockResolvedValue(createMockResponse({}))

      await client.deleteIPBlockingRule(ipRule)

      const calledOptions = fetchSpy.mock.calls[0]![1] as RequestInit
      const body = JSON.parse(calledOptions.body as string)
      expect(body.action).toBe('ip.remove')
      expect(body.id).toBe('ip_1')
      expect(body.value).toBeNull()
    })
  })

  describe('fetchActiveFirewallRules', () => {
    it('should return the rules array from the config', async () => {
      fetchSpy.mockResolvedValue(createMockResponse(mockVercelConfig))

      const rules = await client.fetchActiveFirewallRules()

      expect(rules).toEqual(mockVercelConfig.active.rules)
    })
  })

  describe('verifyCredentials', () => {
    it('should return true when fetch succeeds', async () => {
      fetchSpy.mockResolvedValue(createMockResponse(mockVercelConfig))

      const result = await client.verifyCredentials()

      expect(result).toBe(true)
    })

    it('should return false when fetch fails', async () => {
      fetchSpy.mockResolvedValue(createMockResponse({ error: 'Unauthorized' }, 401, 'Unauthorized'))

      const result = await client.verifyCredentials()

      expect(result).toBe(false)
    })
  })

  describe('error handling for HTTP status codes', () => {
    it('should handle 403 Forbidden', async () => {
      fetchSpy.mockResolvedValue(createMockResponse({ error: 'Forbidden' }, 403, 'Forbidden'))

      await expect(client.fetchFirewallConfig()).rejects.toThrow()
    })

    it('should handle 404 Not Found', async () => {
      fetchSpy.mockResolvedValue(createMockResponse({ error: 'Not Found' }, 404, 'Not Found'))

      await expect(client.fetchFirewallConfig()).rejects.toThrow()
    })

    it('should handle 500 Internal Server Error', async () => {
      fetchSpy.mockResolvedValue(createMockResponse({ error: 'Internal Server Error' }, 500, 'Internal Server Error'))

      await expect(client.fetchFirewallConfig()).rejects.toThrow()
    })

    it('should handle 429 Rate Limit with retry', async () => {
      const rateLimitResponse = createMockResponse({ error: 'Rate Limited' }, 429, 'Too Many Requests')
      fetchSpy.mockResolvedValueOnce(rateLimitResponse).mockResolvedValue(createMockResponse(mockVercelConfig))

      const result = await client.fetchFirewallConfig()

      expect(result).toEqual(mockVercelConfig.active)
      // Should have been called at least twice (first 429, then success)
      expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })
})
