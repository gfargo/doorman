import { unifiedToGcp, gcpToUnified, unifiedIPToGcp, gcpToUnifiedIP, looksLikeIpRule } from '../translator'
import type { UnifiedRule, UnifiedIPRule } from '../../../types/unified'
import type { CloudArmorRule } from '../../../types/gcp'

describe('unifiedToGcp', () => {
  const baseRule: UnifiedRule = {
    name: 'Block admin',
    enabled: true,
    conditions: [{ field: 'path', operator: 'eq', value: '/admin' }],
    action: { type: 'deny' },
    priority: 1000,
  }

  it('throws when the rule has no priority assigned', () => {
    expect(() => unifiedToGcp({ ...baseRule, priority: undefined })).toThrow(/no priority assigned/i)
  })

  it('builds a CEL match expression from conditions', () => {
    const { result } = unifiedToGcp(baseRule)
    expect(result.match.expr.expression).toBe("request.path == '/admin'")
    expect(result.priority).toBe(1000)
  })

  it('maps deny to deny(403)', () => {
    expect(unifiedToGcp(baseRule).result.action).toBe('deny(403)')
  })

  it('maps allow to allow', () => {
    const rule: UnifiedRule = { ...baseRule, action: { type: 'allow' } }
    expect(unifiedToGcp(rule).result.action).toBe('allow')
  })

  it('maps log to allow + preview: true, with no warning', () => {
    const rule: UnifiedRule = { ...baseRule, action: { type: 'log' } }
    const { result, warnings } = unifiedToGcp(rule)
    expect(result.action).toBe('allow')
    expect(result.preview).toBe(true)
    expect(warnings).toHaveLength(0)
  })

  it('maps challenge to deny(403) with an unsupported-feature warning', () => {
    const rule: UnifiedRule = { ...baseRule, action: { type: 'challenge' } }
    const { result, warnings } = unifiedToGcp(rule)
    expect(result.action).toBe('deny(403)')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toMatch(/challenge/i)
  })

  it('maps bypass to allow', () => {
    const rule: UnifiedRule = { ...baseRule, action: { type: 'bypass' } }
    expect(unifiedToGcp(rule).result.action).toBe('allow')
  })

  it('builds rateLimitOptions for a rate_limit action with a rateLimit block', () => {
    const rule: UnifiedRule = {
      ...baseRule,
      action: { type: 'rate_limit', rateLimit: { requests: 100, window: '60s' } },
    }
    const { result, warnings } = unifiedToGcp(rule)
    expect(result.action).toBe('throttle')
    expect(result.rateLimitOptions).toMatchObject({
      rateLimitThreshold: { count: 100, intervalSec: 60 },
      conformAction: 'allow',
    })
    expect(warnings).toHaveLength(0)
  })

  it('warns when a rate_limit action declares no rateLimit block', () => {
    const rule: UnifiedRule = { ...baseRule, action: { type: 'rate_limit' } }
    const { result, warnings } = unifiedToGcp(rule)
    expect(result.action).toBe('throttle')
    expect(result.rateLimitOptions).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it('builds redirectOptions for a redirect action with a target', () => {
    const rule: UnifiedRule = {
      ...baseRule,
      action: { type: 'redirect', redirect: { location: 'https://example.com' } },
    }
    const { result, warnings } = unifiedToGcp(rule)
    expect(result.action).toBe('redirect')
    expect(result.redirectOptions).toEqual({ type: 'EXTERNAL_302', target: 'https://example.com' })
    expect(warnings).toHaveLength(0)
  })

  it('warns when a redirect action declares no target', () => {
    const rule: UnifiedRule = { ...baseRule, action: { type: 'redirect' } }
    const { result, warnings } = unifiedToGcp(rule)
    expect(result.action).toBe('redirect')
    expect(result.redirectOptions).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it('truncates the description to 64 chars (Cloud Armor limit)', () => {
    const rule: UnifiedRule = { ...baseRule, name: 'x'.repeat(100) }
    expect(unifiedToGcp(rule).result.description!.length).toBeLessThanOrEqual(64)
  })
})

describe('gcpToUnified', () => {
  const baseGcpRule: CloudArmorRule = {
    priority: 2000,
    description: 'Block admin',
    match: { expr: { expression: "request.path == '/admin'" } },
    action: 'deny(403)',
  }

  it('sets id and priority to the rule priority, stringified/numeric respectively', () => {
    const { result } = gcpToUnified(baseGcpRule)
    expect(result.id).toBe('2000')
    expect(result.priority).toBe(2000)
  })

  it('parses the CEL expression back into conditions', () => {
    const { result, warnings } = gcpToUnified(baseGcpRule)
    expect(result.conditions).toEqual([{ field: 'path', operator: 'eq', value: '/admin' }])
    expect(warnings).toHaveLength(0)
  })

  it('warns and returns empty conditions for an unparseable expression', () => {
    const rule: CloudArmorRule = { ...baseGcpRule, match: { expr: { expression: 'not valid cel!!' } } }
    const { result, warnings } = gcpToUnified(rule)
    expect(result.conditions).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  it('maps deny(403)/deny(404)/deny(502) all to the unified "deny" action', () => {
    expect(gcpToUnified({ ...baseGcpRule, action: 'deny(403)' }).result.action.type).toBe('deny')
    expect(gcpToUnified({ ...baseGcpRule, action: 'deny(404)' }).result.action.type).toBe('deny')
    expect(gcpToUnified({ ...baseGcpRule, action: 'deny(502)' }).result.action.type).toBe('deny')
  })

  it('maps throttle/rate_based_ban to the unified "rate_limit" action', () => {
    expect(gcpToUnified({ ...baseGcpRule, action: 'throttle' }).result.action.type).toBe('rate_limit')
    expect(gcpToUnified({ ...baseGcpRule, action: 'rate_based_ban' }).result.action.type).toBe('rate_limit')
  })

  it('a previewed rule translates to enabled: false', () => {
    expect(gcpToUnified({ ...baseGcpRule, preview: true }).result.enabled).toBe(false)
    expect(gcpToUnified({ ...baseGcpRule, preview: false }).result.enabled).toBe(true)
    expect(gcpToUnified(baseGcpRule).result.enabled).toBe(true)
  })

  it('recovers rateLimit from rateLimitOptions', () => {
    const rule: CloudArmorRule = {
      ...baseGcpRule,
      action: 'throttle',
      rateLimitOptions: {
        rateLimitThreshold: { count: 50, intervalSec: 60 },
        conformAction: 'allow',
        exceedAction: 'deny(429)',
      },
    }
    expect(gcpToUnified(rule).result.action.rateLimit).toEqual({ requests: 50, window: '60s' })
  })

  it('recovers redirect from redirectOptions', () => {
    const rule: CloudArmorRule = {
      ...baseGcpRule,
      action: 'redirect',
      redirectOptions: { type: 'EXTERNAL_302', target: 'https://example.com' },
    }
    expect(gcpToUnified(rule).result.action.redirect).toEqual({ location: 'https://example.com' })
  })
})

describe('looksLikeIpRule / unifiedIPToGcp / gcpToUnifiedIP', () => {
  const ip: UnifiedIPRule = { ip: '203.0.113.9', notes: 'known bad actor', action: 'deny' }

  it('unifiedIPToGcp produces a rule looksLikeIpRule recognizes', () => {
    const rule = unifiedIPToGcp(ip, 3000)
    expect(looksLikeIpRule(rule)).toBe(true)
  })

  it('round-trips a deny IP rule', () => {
    const rule = unifiedIPToGcp(ip, 3000)
    const recovered = gcpToUnifiedIP(rule)
    expect(recovered).toEqual({ id: '3000', ip: '203.0.113.9', notes: 'known bad actor', action: 'deny' })
  })

  it('round-trips an allow IP rule', () => {
    const allowIp: UnifiedIPRule = { ip: '198.51.100.0/24', action: 'allow' }
    const rule = unifiedIPToGcp(allowIp, 3001)
    expect(looksLikeIpRule(rule)).toBe(true)
    expect(gcpToUnifiedIP(rule).action).toBe('allow')
  })

  it('uses inIpRange() for a CIDR value', () => {
    const rule = unifiedIPToGcp({ ip: '198.51.100.0/24', action: 'deny' }, 3002)
    expect(rule.match.expr.expression).toBe("inIpRange(origin.ip, '198.51.100.0/24')")
  })

  it('throws for an invalid IP value', () => {
    expect(() => unifiedIPToGcp({ ip: 'not-an-ip', action: 'deny' }, 3003)).toThrow(/Invalid IP/i)
  })

  it('does not classify a custom rule with an extra condition as an IP rule, even if it checks ip', () => {
    const rule: CloudArmorRule = {
      priority: 4000,
      match: { expr: { expression: "(origin.ip == '203.0.113.9' && request.path == '/admin')" } },
      action: 'deny(403)',
    }
    expect(looksLikeIpRule(rule)).toBe(false)
  })

  it('does not classify a preview (log-only) rule as an IP rule', () => {
    const rule = unifiedIPToGcp(ip, 3004)
    expect(looksLikeIpRule({ ...rule, preview: true })).toBe(false)
  })

  it('does not classify a redirect/throttle-action ip check as an IP rule', () => {
    const rule = unifiedIPToGcp(ip, 3005)
    expect(looksLikeIpRule({ ...rule, action: 'redirect' })).toBe(false)
  })

  it('does not classify a multi-value ip "in" condition wrapped with extra conditions', () => {
    const rule: CloudArmorRule = {
      priority: 4001,
      match: {
        expr: {
          expression: "(origin.ip in ['203.0.113.9'] && request.method == 'POST')",
        },
      },
      action: 'deny(403)',
    }
    // Not actually parseable as a single ip condition by the real CEL
    // grammar this parser understands (it's an AND of two leaves) — belt
    // and suspenders check that this never misclassifies.
    expect(looksLikeIpRule(rule)).toBe(false)
  })
})
