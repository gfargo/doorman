import { firewallRuleSchema, ipBlockingRuleSchema } from '../firewallSchemas'

describe('firewallSchemas', () => {
  describe('firewallRuleSchema text limits (Vercel API: name 160, description 256)', () => {
    const rule = {
      id: 'rule_a',
      name: 'ok',
      conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/a' }] }],
      action: { mitigate: { action: 'log' } },
      active: true,
    }

    it('rejects a description over 256 characters, naming the limit', () => {
      const result = firewallRuleSchema.safeParse({ ...rule, description: 'x'.repeat(257) })
      expect(result.success).toBe(false)
      expect(JSON.stringify(result.error?.errors)).toContain('256 characters')
    })

    it('rejects a name over 160 characters', () => {
      expect(firewallRuleSchema.safeParse({ ...rule, name: 'n'.repeat(161) }).success).toBe(false)
    })

    it('accepts values exactly at the limits', () => {
      expect(
        firewallRuleSchema.safeParse({ ...rule, name: 'n'.repeat(160), description: 'x'.repeat(256) }).success,
      ).toBe(true)
    })
  })

  describe('ipBlockingRuleSchema', () => {
    it('accepts an IP rule with hostname omitted, matching unifiedIPRuleSchema and the documented behavior (regression test for #219)', () => {
      // The exact real-world case from #219, isolated to just this field.
      const result = ipBlockingRuleSchema.safeParse({
        ip: '192.168.1.100/32',
        action: 'deny',
        notes: 'blocked',
      })
      expect(result.success).toBe(true)
    })

    it('still accepts an IP rule with hostname present', () => {
      const result = ipBlockingRuleSchema.safeParse({
        ip: '192.168.1.100/32',
        hostname: 'example.com',
        action: 'deny',
      })
      expect(result.success).toBe(true)
    })

    it('still rejects a missing/invalid ip', () => {
      expect(ipBlockingRuleSchema.safeParse({ action: 'deny' }).success).toBe(false)
      expect(ipBlockingRuleSchema.safeParse({ ip: 'not-an-ip', action: 'deny' }).success).toBe(false)
    })
  })
})
