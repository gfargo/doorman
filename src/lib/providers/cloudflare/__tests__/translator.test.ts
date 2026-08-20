jest.mock('../../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { cloudflareToUnified, unifiedToCloudflare, unifiedIPToCloudflare } from '../translator'
import type { CloudflareRule } from '../../../types/cloudflare'
import type { UnifiedRule, UnifiedIPRule } from '../../../types/unified'

// Split out of the former RuleTranslator.test.ts as part of #196 — this
// covers exactly the Cloudflare <-> Unified directions now living in
// ../translator. The window-parsing tests were previously exercised only
// through the (now-removed, dead) vercelToCloudflare — retargeted here at
// unifiedToCloudflare, the live path that actually uses parseWindowToSeconds,
// so s/m/h/d coverage isn't lost.

// Helper to create a minimal Cloudflare rule
function makeCloudflareRule(overrides: Partial<CloudflareRule> = {}): CloudflareRule {
  return {
    id: 'cf-rule-1',
    action: 'block',
    expression: 'http.request.uri.path eq "/api"',
    description: 'A test rule',
    enabled: true,
    ...overrides,
  }
}

// Helper to create a minimal Unified rule
function makeUnifiedRule(overrides: Partial<UnifiedRule> = {}): UnifiedRule {
  return {
    id: 'unified-1',
    name: 'Test Rule',
    description: 'A test rule',
    enabled: true,
    conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
    action: { type: 'deny' },
    ...overrides,
  }
}

describe('cloudflare/translator', () => {
  describe('cloudflareToUnified', () => {
    it('translates a basic block rule, parsing the expression back into structured conditions', () => {
      const cfRule = makeCloudflareRule()
      const { result, warnings } = cloudflareToUnified(cfRule)

      expect(result.id).toBe('cf-rule-1')
      expect(result.name).toBe('A test rule')
      expect(result.enabled).toBe(true)
      expect(result.action.type).toBe('deny')
      expect(result.conditions).toEqual([
        { field: 'path', operator: 'eq', value: '/api', key: undefined, negated: undefined, group: 0 },
      ])
      // A successfully-parsed expression gets no "couldn't parse" warning.
      expect(warnings).toEqual([])
    })

    it('falls back to empty conditions with a warning when the expression is outside what WirefilterParser understands', () => {
      const cfRule = makeCloudflareRule({ expression: 'http.request.body.raw contains "x"' })
      const { result, warnings } = cloudflareToUnified(cfRule)

      expect(result.conditions).toEqual([])
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings.some((w) => w.field === 'expression')).toBe(true)
    })

    it('maps Cloudflare actions to unified actions', () => {
      const actionMappings: Array<{ cf: CloudflareRule['action']; unified: string }> = [
        { cf: 'block', unified: 'deny' },
        { cf: 'challenge', unified: 'challenge' },
        { cf: 'managed_challenge', unified: 'challenge' },
        { cf: 'js_challenge', unified: 'challenge' },
        { cf: 'log', unified: 'log' },
        { cf: 'skip', unified: 'bypass' },
        { cf: 'allow', unified: 'allow' },
        { cf: 'rewrite', unified: 'bypass' },
        { cf: 'redirect', unified: 'redirect' },
      ]

      for (const { cf, unified } of actionMappings) {
        const rule = makeCloudflareRule({ action: cf })
        const { result } = cloudflareToUnified(rule)
        expect(result.action.type).toBe(unified)
      }
    })

    it('translates rate limit configuration', () => {
      const rule = makeCloudflareRule({
        ratelimit: {
          characteristics: ['ip.src'],
          period: 60,
          requests_per_period: 100,
          mitigation_timeout: 3600,
          counting_expression: 'http.request.uri.path contains "/api"',
        },
      })
      const { result } = cloudflareToUnified(rule)
      expect(result.action.rateLimit).toMatchObject({
        requests: 100,
        window: '60s',
        characteristics: ['ip.src'],
        mitigationTimeout: 3600,
        countingExpression: 'http.request.uri.path contains "/api"',
      })
    })

    it('uses rule id as name fallback when description is missing', () => {
      const rule = makeCloudflareRule({ description: undefined })
      const { result } = cloudflareToUnified(rule)
      expect(result.name).toBe(`Rule ${rule.id}`)
    })

    it('defaults enabled to true when not specified', () => {
      const rule = makeCloudflareRule({ enabled: undefined })
      const { result } = cloudflareToUnified(rule)
      expect(result.enabled).toBe(true)
    })
  })

  describe('unifiedToCloudflare', () => {
    it('translates a basic deny rule', () => {
      const unified = makeUnifiedRule()
      const { result } = unifiedToCloudflare(unified)

      expect(result.action).toBe('block')
      expect(result.expression).toContain('http.request.uri.path')
      expect(result.description).toBe('A test rule')
      expect(result.enabled).toBe(true)
    })

    it('maps unified actions to Cloudflare actions', () => {
      const actionMappings: Array<{ unified: string; cf: string }> = [
        { unified: 'log', cf: 'log' },
        { unified: 'deny', cf: 'block' },
        { unified: 'block', cf: 'block' },
        { unified: 'challenge', cf: 'managed_challenge' },
        { unified: 'bypass', cf: 'skip' },
        { unified: 'rate_limit', cf: 'block' },
        { unified: 'redirect', cf: 'redirect' },
        { unified: 'allow', cf: 'allow' },
      ]

      for (const { unified, cf } of actionMappings) {
        const rule = makeUnifiedRule({ action: { type: unified as any } })
        const { result } = unifiedToCloudflare(rule)
        expect(result.action).toBe(cf)
      }
    })

    it('translates rate limit configuration', () => {
      const rule = makeUnifiedRule({
        action: {
          type: 'rate_limit',
          rateLimit: {
            requests: 100,
            window: '1m',
            characteristics: ['ip.src'],
            mitigationTimeout: 600,
            countingExpression: 'true',
          },
        },
      })
      const { result } = unifiedToCloudflare(rule)
      expect(result.ratelimit).toMatchObject({
        characteristics: ['ip.src'],
        period: 60,
        requests_per_period: 100,
        mitigation_timeout: 600,
        counting_expression: 'true',
      })
    })

    it('defaults rate limit characteristics to ip.src', () => {
      const rule = makeUnifiedRule({
        action: {
          type: 'rate_limit',
          rateLimit: { requests: 10, window: '60s' },
        },
      })
      const { result } = unifiedToCloudflare(rule)
      expect(result.ratelimit!.characteristics).toEqual(['ip.src'])
    })

    it('defaults mitigation_timeout to 3600 when not specified', () => {
      const rule = makeUnifiedRule({
        action: {
          type: 'rate_limit',
          rateLimit: { requests: 10, window: '60s' },
        },
      })
      const { result } = unifiedToCloudflare(rule)
      expect(result.ratelimit!.mitigation_timeout).toBe(3600)
    })

    it('uses rule name as description fallback', () => {
      const rule = makeUnifiedRule({ description: undefined })
      const { result } = unifiedToCloudflare(rule)
      expect(result.description).toBe('Test Rule')
    })

    describe('rate limit window parsing', () => {
      it('parses seconds', () => {
        const rule = makeUnifiedRule({
          action: { type: 'rate_limit', rateLimit: { requests: 10, window: '60s' } },
        })
        const { result } = unifiedToCloudflare(rule)
        expect(result.ratelimit!.period).toBe(60)
      })

      it('parses minutes', () => {
        const rule = makeUnifiedRule({
          action: { type: 'rate_limit', rateLimit: { requests: 10, window: '5m' } },
        })
        const { result } = unifiedToCloudflare(rule)
        expect(result.ratelimit!.period).toBe(300)
      })

      it('parses hours', () => {
        const rule = makeUnifiedRule({
          action: { type: 'rate_limit', rateLimit: { requests: 10, window: '1h' } },
        })
        const { result } = unifiedToCloudflare(rule)
        expect(result.ratelimit!.period).toBe(3600)
      })

      it('parses days', () => {
        const rule = makeUnifiedRule({
          action: { type: 'rate_limit', rateLimit: { requests: 10, window: '1d' } },
        })
        const { result } = unifiedToCloudflare(rule)
        expect(result.ratelimit!.period).toBe(86400)
      })
    })
  })

  // Regression coverage for #180: UnifiedAction.response was declared in the
  // public type and unified schema but had zero consumers anywhere — a user
  // could set a custom block page, pass validation, sync cleanly, and get
  // nothing.
  describe('custom response body (UnifiedAction.response)', () => {
    const denyRuleWithResponse = (response: UnifiedRule['action']['response']): UnifiedRule => ({
      id: 'r1',
      name: 'Blocked',
      enabled: true,
      conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
      action: { type: 'deny', response },
    })

    it('emits action_parameters.response for a block action', () => {
      const { result, warnings } = unifiedToCloudflare(
        denyRuleWithResponse({ statusCode: 429, content: 'Slow down', contentType: 'text/plain' }),
      )

      expect(result.action_parameters).toEqual({
        response: { status_code: 429, content: 'Slow down', content_type: 'text/plain' },
      })
      expect(warnings).toEqual([])
    })

    it('defaults statusCode to 403 and contentType to text/plain when only content is given', () => {
      const { result } = unifiedToCloudflare(denyRuleWithResponse({ content: 'Denied' }))

      expect(result.action_parameters).toEqual({
        response: { status_code: 403, content: 'Denied', content_type: 'text/plain' },
      })
    })

    it('warns and drops the response when content is missing (Cloudflare requires a body)', () => {
      const { result, warnings } = unifiedToCloudflare(denyRuleWithResponse({ statusCode: 418 }))

      expect(result.action_parameters).toBeUndefined()
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings.some((w) => w.field === 'action.response')).toBe(true)
    })

    it('warns when a custom response is set on a non-block action', () => {
      const rule: UnifiedRule = {
        id: 'r2',
        name: 'Challenged',
        enabled: true,
        conditions: [{ field: 'path', operator: 'eq', value: '/api' }],
        action: { type: 'challenge', response: { content: 'nope' } },
      }

      const { result, warnings } = unifiedToCloudflare(rule)

      expect(result.action_parameters).toBeUndefined()
      expect(warnings.some((w) => w.field === 'action.response')).toBe(true)
    })

    it('recovers the response when translating a Cloudflare rule back to unified', () => {
      const cfRule = makeCloudflareRule({
        action: 'block',
        action_parameters: { response: { status_code: 429, content: 'Slow down', content_type: 'text/html' } },
      })

      const { result } = cloudflareToUnified(cfRule)

      expect(result.action.response).toEqual({ statusCode: 429, content: 'Slow down', contentType: 'text/html' })
    })

    it('round-trips a custom response through unified -> Cloudflare -> unified', () => {
      const original = denyRuleWithResponse({ statusCode: 429, content: 'Slow down', contentType: 'text/html' })

      const cf = unifiedToCloudflare(original).result
      const back = cloudflareToUnified(cf).result

      expect(back.action.response).toEqual(original.action.response)
    })

    it('leaves action.response undefined for a Cloudflare rule that has none', () => {
      const { result } = cloudflareToUnified(makeCloudflareRule())

      expect(result.action.response).toBeUndefined()
    })
  })

  describe('unifiedIPToCloudflare', () => {
    it('translates a deny IP rule to Cloudflare block', () => {
      const ip: UnifiedIPRule = {
        id: 'ip-1',
        ip: '10.0.0.1',
        hostname: 'bad.example.com',
        notes: 'Malicious IP',
        action: 'deny',
      }
      const result = unifiedIPToCloudflare(ip)
      expect(result.action).toBe('block')
      expect(result.expression).toBe('ip.src eq 10.0.0.1')
      expect(result.description).toContain('Malicious IP')
      expect(result.enabled).toBe(true)
    })

    it('translates an allow IP rule to Cloudflare allow', () => {
      const ip: UnifiedIPRule = {
        id: 'ip-2',
        ip: '10.0.0.2',
        action: 'allow',
      }
      const result = unifiedIPToCloudflare(ip)
      expect(result.action).toBe('allow')
      expect(result.expression).toBe('ip.src eq 10.0.0.2')
    })

    it('includes hostname in description when present', () => {
      const ip: UnifiedIPRule = {
        ip: '10.0.0.1',
        hostname: 'server.example.com',
        action: 'deny',
      }
      const result = unifiedIPToCloudflare(ip)
      expect(result.description).toContain('server.example.com')
    })

    it('generates description without hostname when not present', () => {
      const ip: UnifiedIPRule = {
        ip: '10.0.0.1',
        action: 'deny',
      }
      const result = unifiedIPToCloudflare(ip)
      expect(result.description).toContain('IP deny: 10.0.0.1')
      expect(result.description).not.toContain('(')
    })

    it('translates a CIDR range using the `in` set operator, not `eq` (regression test for #86)', () => {
      const ip: UnifiedIPRule = { ip: '203.0.113.0/24', action: 'deny' }
      const result = unifiedIPToCloudflare(ip)
      // wirefilter's `eq` only matches a single IP literal — a CIDR range
      // needs `in {…}` or Cloudflare's ruleset API rejects the rule.
      expect(result.expression).toBe('ip.src in {203.0.113.0/24}')
    })

    it('still uses `eq` for a single (non-CIDR) IP', () => {
      const ip: UnifiedIPRule = { ip: '203.0.113.5', action: 'deny' }
      const result = unifiedIPToCloudflare(ip)
      expect(result.expression).toBe('ip.src eq 203.0.113.5')
    })

    it('rejects an IP value that would inject additional wirefilter syntax', () => {
      const ip: UnifiedIPRule = { ip: '1.2.3.4 or (true) or ip.src eq 1.2.3.4', action: 'deny' }
      expect(() => unifiedIPToCloudflare(ip)).toThrow('Invalid IP address or CIDR range')
    })
  })
})
