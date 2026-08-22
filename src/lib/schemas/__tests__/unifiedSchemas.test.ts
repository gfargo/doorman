import {
  unifiedConditionSchema,
  unifiedActionSchema,
  unifiedRuleSchema,
  unifiedIPRuleSchema,
  unifiedConfigSchema,
  validateUnifiedConfig,
} from '../unifiedSchemas'

describe('unifiedSchemas', () => {
  describe('unifiedConditionSchema', () => {
    it('accepts a valid condition', () => {
      const result = unifiedConditionSchema.safeParse({
        field: 'path',
        operator: 'eq',
        value: '/api',
      })
      expect(result.success).toBe(true)
    })

    it('accepts condition with optional fields', () => {
      const result = unifiedConditionSchema.safeParse({
        field: 'header',
        operator: 'eq',
        value: 'application/json',
        negated: true,
        key: 'Content-Type',
      })
      expect(result.success).toBe(true)
    })

    it('accepts array values', () => {
      const result = unifiedConditionSchema.safeParse({
        field: 'country',
        operator: 'in',
        value: ['US', 'CA', 'GB'],
      })
      expect(result.success).toBe(true)
    })

    it('accepts numeric values', () => {
      const result = unifiedConditionSchema.safeParse({
        field: 'asn',
        operator: 'eq',
        value: 13335,
      })
      expect(result.success).toBe(true)
    })

    it('accepts custom field types (string)', () => {
      const result = unifiedConditionSchema.safeParse({
        field: 'custom_field',
        operator: 'eq',
        value: 'test',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid operator', () => {
      const result = unifiedConditionSchema.safeParse({
        field: 'path',
        operator: 'invalid_op',
        value: '/api',
      })
      expect(result.success).toBe(false)
    })

    it.each(['exists', 'not_exists'])(
      'accepts a %s condition with no value at all, matching ruleConditionSchema (regression test for #213)',
      (operator) => {
        // The exact real-world case from #213 (a deployed griffen.codes rule,
        // translated from Vercel's `op: "nex"` via mapVercelOperatorToUnified).
        const result = unifiedConditionSchema.safeParse({
          field: 'cookie',
          operator,
          key: 'supabase_auth',
        })
        expect(result.success).toBe(true)
      },
    )

    it('still requires a value for every other operator', () => {
      const result = unifiedConditionSchema.safeParse({ field: 'path', operator: 'eq' })
      expect(result.success).toBe(false)
    })
  })

  describe('unifiedActionSchema', () => {
    it('accepts a basic action', () => {
      const result = unifiedActionSchema.safeParse({ type: 'deny' })
      expect(result.success).toBe(true)
    })

    it('accepts all valid action types', () => {
      const types = ['log', 'deny', 'challenge', 'bypass', 'rate_limit', 'redirect', 'allow', 'block']
      for (const type of types) {
        expect(unifiedActionSchema.safeParse({ type }).success).toBe(true)
      }
    })

    it('accepts action with rateLimit', () => {
      const result = unifiedActionSchema.safeParse({
        type: 'rate_limit',
        rateLimit: { requests: 100, window: '1m' },
      })
      expect(result.success).toBe(true)
    })

    it('accepts action with redirect', () => {
      const result = unifiedActionSchema.safeParse({
        type: 'redirect',
        redirect: { location: 'https://example.com', permanent: true },
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid action type', () => {
      const result = unifiedActionSchema.safeParse({ type: 'invalid' })
      expect(result.success).toBe(false)
    })
  })

  describe('unifiedRuleSchema', () => {
    const validRule = {
      name: 'Test Rule',
      enabled: true,
      conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
      action: { type: 'deny' },
    }

    it('accepts a valid rule', () => {
      const result = unifiedRuleSchema.safeParse(validRule)
      expect(result.success).toBe(true)
    })

    it('accepts rule with all optional fields', () => {
      const result = unifiedRuleSchema.safeParse({
        ...validRule,
        id: 'rule-1',
        description: 'A test rule',
        conditionLogic: 'OR',
        priority: 1,
        categories: ['security'],
      })
      expect(result.success).toBe(true)
    })

    it('defaults conditionLogic to AND', () => {
      const result = unifiedRuleSchema.safeParse(validRule)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.conditionLogic).toBe('AND')
      }
    })

    it('rejects rule with empty name', () => {
      const result = unifiedRuleSchema.safeParse({ ...validRule, name: '' })
      expect(result.success).toBe(false)
    })

    it('rejects rule with empty conditions', () => {
      const result = unifiedRuleSchema.safeParse({ ...validRule, conditions: [] })
      expect(result.success).toBe(false)
    })

    it('rejects rule without action', () => {
      const { action, ...ruleWithoutAction } = validRule
      const result = unifiedRuleSchema.safeParse(ruleWithoutAction)
      expect(result.success).toBe(false)
    })
  })

  describe('unifiedIPRuleSchema', () => {
    it('accepts a valid deny IP rule', () => {
      const result = unifiedIPRuleSchema.safeParse({
        ip: '192.168.1.1',
        action: 'deny',
      })
      expect(result.success).toBe(true)
    })

    it('accepts a valid allow IP rule', () => {
      const result = unifiedIPRuleSchema.safeParse({
        ip: '10.0.0.1',
        action: 'allow',
      })
      expect(result.success).toBe(true)
    })

    it('accepts IP rule with optional fields', () => {
      const result = unifiedIPRuleSchema.safeParse({
        id: 'ip-1',
        ip: '192.168.1.0/24',
        hostname: 'example.com',
        notes: 'Blocked subnet',
        action: 'deny',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid action', () => {
      const result = unifiedIPRuleSchema.safeParse({
        ip: '192.168.1.1',
        action: 'block',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid IP address', () => {
      const result = unifiedIPRuleSchema.safeParse({
        ip: 'not-an-ip',
        action: 'deny',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('unifiedConfigSchema', () => {
    const validConfig = {
      rules: [
        {
          name: 'Test Rule',
          enabled: true,
          conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
          action: { type: 'deny' },
        },
      ],
    }

    it('accepts a valid config', () => {
      const result = unifiedConfigSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it('accepts config with all optional fields', () => {
      const result = unifiedConfigSchema.safeParse({
        ...validConfig,
        $schema: 'https://doorman.griffen.codes/schema.json',
        version: '2.0',
        provider: 'vercel',
        providers: {
          vercel: { projectId: 'proj-123', teamId: 'team-123' },
        },
        ips: [{ ip: '192.168.1.1', action: 'deny' }],
      })
      expect(result.success).toBe(true)
    })

    it('rejects config without rules', () => {
      const result = unifiedConfigSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe('validateUnifiedConfig', () => {
    it('returns valid config', () => {
      const config = {
        rules: [
          {
            name: 'Test Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
            action: { type: 'deny' },
          },
        ],
      }
      const result = validateUnifiedConfig(config)
      expect(result.rules).toHaveLength(1)
    })

    it('throws for invalid config', () => {
      expect(() => validateUnifiedConfig({})).toThrow(/Invalid unified configuration/)
    })

    it('throws when provider specified but no provider config', () => {
      const config = {
        provider: 'vercel',
        rules: [
          {
            name: 'Test Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
            action: { type: 'deny' },
          },
        ],
      }
      expect(() => validateUnifiedConfig(config)).toThrow(/no configuration found/)
    })

    it('passes when provider specified with matching provider config', () => {
      const config = {
        provider: 'vercel',
        providers: { vercel: { projectId: 'proj-123' } },
        rules: [
          {
            name: 'Test Rule',
            enabled: true,
            conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
            action: { type: 'deny' },
          },
        ],
      }
      expect(() => validateUnifiedConfig(config)).not.toThrow()
    })
  })
})
