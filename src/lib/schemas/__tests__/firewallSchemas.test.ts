import { ipBlockingRuleSchema } from '../firewallSchemas'

describe('firewallSchemas', () => {
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
