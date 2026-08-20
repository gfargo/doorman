jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { RuleTranslator } from '../RuleTranslator'
import type { VercelCustomRule, VercelIPBlockingRule } from '../../types/vercel'
import type { CloudflareRule } from '../../types/cloudflare'
import type { UnifiedRule, UnifiedIPRule } from '../../types/unified'

// Helper to create a minimal Vercel rule
function makeVercelRule(overrides: Partial<VercelCustomRule> = {}): VercelCustomRule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    description: 'A test rule',
    conditionGroup: [
      {
        conditions: [{ type: 'path', op: 'eq', value: '/api' }],
      },
    ],
    action: { mitigate: { action: 'deny' } },
    active: true,
    ...overrides,
  }
}

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

describe('RuleTranslator', () => {
  describe('vercelToUnified', () => {
    it('translates a basic deny rule', () => {
      const vercelRule = makeVercelRule()
      const { result } = RuleTranslator.vercelToUnified(vercelRule)

      expect(result.id).toBe('rule-1')
      expect(result.name).toBe('Test Rule')
      expect(result.description).toBe('A test rule')
      expect(result.enabled).toBe(true)
      expect(result.action.type).toBe('deny')
      expect(result.conditions).toHaveLength(1)
      expect(result.conditions[0]).toMatchObject({
        field: 'path',
        operator: 'eq',
        value: '/api',
        group: 0,
      })
      // Regression test: a single-group rule is AND semantics (there's
      // nothing to OR against), not the previously-hardcoded 'OR'.
      expect(result.conditionLogic).toBe('AND')
    })

    it('translates all Vercel operators to unified operators', () => {
      const ops = [
        { vercel: 'eq', unified: 'eq' },
        { vercel: 'pre', unified: 'starts_with' },
        { vercel: 'suf', unified: 'ends_with' },
        { vercel: 'inc', unified: 'in' },
        { vercel: 'sub', unified: 'contains' },
        { vercel: 're', unified: 'matches' },
        { vercel: 'ex', unified: 'exists' },
        { vercel: 'nex', unified: 'not_exists' },
      ] as const

      for (const { vercel, unified } of ops) {
        const rule = makeVercelRule({
          conditionGroup: [{ conditions: [{ type: 'path', op: vercel, value: 'test' }] }],
        })
        const { result } = RuleTranslator.vercelToUnified(rule)
        expect(result.conditions[0]!.operator).toBe(unified)
      }
    })

    it('translates Vercel field types to unified field types', () => {
      const mappings = [
        { vercel: 'host', unified: 'host' },
        { vercel: 'path', unified: 'path' },
        { vercel: 'method', unified: 'method' },
        { vercel: 'header', unified: 'header' },
        { vercel: 'query', unified: 'query' },
        { vercel: 'cookie', unified: 'cookie' },
        { vercel: 'ip_address', unified: 'ip' },
        { vercel: 'user_agent', unified: 'user_agent' },
        { vercel: 'geo_country', unified: 'country' },
        { vercel: 'geo_city', unified: 'city' },
        { vercel: 'geo_as_number', unified: 'asn' },
        { vercel: 'scheme', unified: 'scheme' },
      ] as const

      for (const { vercel, unified } of mappings) {
        const rule = makeVercelRule({
          conditionGroup: [{ conditions: [{ type: vercel, op: 'eq', value: 'test' }] }],
        })
        const { result } = RuleTranslator.vercelToUnified(rule)
        expect(result.conditions[0]!.field).toBe(unified)
      }
    })

    it('preserves negation flag', () => {
      const rule = makeVercelRule({
        conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/api', neg: true }] }],
      })
      const { result } = RuleTranslator.vercelToUnified(rule)
      expect(result.conditions[0]!.negated).toBe(true)
    })

    it('preserves key for header conditions', () => {
      const rule = makeVercelRule({
        conditionGroup: [{ conditions: [{ type: 'header', op: 'eq', value: 'test', key: 'X-Custom' }] }],
      })
      const { result } = RuleTranslator.vercelToUnified(rule)
      expect(result.conditions[0]!.key).toBe('X-Custom')
    })

    it('translates rate_limit action with config', () => {
      const rule = makeVercelRule({
        action: {
          mitigate: {
            action: 'rate_limit',
            rateLimit: { requests: 100, window: '1m' },
          },
        },
      })
      const { result } = RuleTranslator.vercelToUnified(rule)
      expect(result.action.type).toBe('rate_limit')
      expect(result.action.rateLimit).toMatchObject({ requests: 100, window: '1m' })
    })

    it('translates redirect action with config', () => {
      const rule = makeVercelRule({
        action: {
          mitigate: {
            action: 'redirect',
            redirect: { location: '/new-path', permanent: true },
          },
        },
      })
      const { result } = RuleTranslator.vercelToUnified(rule)
      expect(result.action.type).toBe('redirect')
      expect(result.action.redirect).toMatchObject({ location: '/new-path', permanent: true })
    })

    it('translates actionDuration to duration', () => {
      const rule = makeVercelRule({
        action: { mitigate: { action: 'deny', actionDuration: '1h' } },
      })
      const { result } = RuleTranslator.vercelToUnified(rule)
      expect(result.action.duration).toBe('1h')
    })

    it('generates warning for regex patterns', () => {
      const rule = makeVercelRule({
        conditionGroup: [{ conditions: [{ type: 'path', op: 're', value: '^/api/v[0-9]+' }] }],
      })
      const { warnings } = RuleTranslator.vercelToUnified(rule)
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings.some((w) => w.category === 'syntax_limitation')).toBe(true)
    })

    it('flattens multiple condition groups', () => {
      const rule = makeVercelRule({
        conditionGroup: [
          { conditions: [{ type: 'path', op: 'eq', value: '/api' }] },
          { conditions: [{ type: 'method', op: 'eq', value: 'POST' }] },
        ],
      })
      const { result } = RuleTranslator.vercelToUnified(rule)
      expect(result.conditions).toHaveLength(2)
    })

    // Regression test: multi-group rules are a real, documented pattern
    // (used throughout examples/*.json) — vercelToUnified previously
    // flattened all conditions into one array with no way to tell which
    // came from which group, and hardcoded conditionLogic: 'OR' regardless
    // of actual structure (wrongly applying OR-semantics even within what
    // should be an AND'd group). Each condition must carry its source
    // group index so unifiedToVercel can reconstruct the original
    // AND-within/OR-across structure.
    it('tags each condition with its source group index', () => {
      const rule = makeVercelRule({
        conditionGroup: [
          {
            conditions: [
              { type: 'path', op: 'eq', value: '/api' },
              { type: 'method', op: 'eq', value: 'POST' },
            ],
          },
          { conditions: [{ type: 'header', op: 'eq', value: 'x', key: 'X-Custom' }] },
        ],
      })
      const { result } = RuleTranslator.vercelToUnified(rule)

      expect(result.conditions[0]?.group).toBe(0)
      expect(result.conditions[1]?.group).toBe(0)
      expect(result.conditions[2]?.group).toBe(1)
      expect(result.conditionLogic).toBe('OR')
    })
  })

  describe('unifiedToVercel', () => {
    it('translates a basic deny rule', () => {
      const unified = makeUnifiedRule()
      const { result } = RuleTranslator.unifiedToVercel(unified)

      expect(result.id).toBe('unified-1')
      expect(result.name).toBe('Test Rule')
      expect(result.active).toBe(true)
      expect(result.action.mitigate.action).toBe('deny')
      expect(result.conditionGroup).toHaveLength(1)
      expect(result.conditionGroup[0]!.conditions).toHaveLength(1)
    })

    it('translates unified operators back to Vercel operators', () => {
      const ops = [
        { unified: 'eq', vercel: 'eq' },
        { unified: 'starts_with', vercel: 'pre' },
        { unified: 'ends_with', vercel: 'suf' },
        { unified: 'in', vercel: 'inc' },
        { unified: 'contains', vercel: 'sub' },
        { unified: 'matches', vercel: 're' },
        { unified: 'exists', vercel: 'ex' },
        { unified: 'not_exists', vercel: 'nex' },
      ] as const

      for (const { unified, vercel } of ops) {
        const rule = makeUnifiedRule({
          conditions: [{ field: 'path', operator: unified, value: 'test' }],
        })
        const { result } = RuleTranslator.unifiedToVercel(rule)
        expect(result.conditionGroup[0]!.conditions[0]!.op).toBe(vercel)
      }
    })

    it('translates unified field types back to Vercel types', () => {
      const mappings = [
        { unified: 'host', vercel: 'host' },
        { unified: 'path', vercel: 'path' },
        { unified: 'method', vercel: 'method' },
        { unified: 'ip', vercel: 'ip_address' },
        { unified: 'user_agent', vercel: 'user_agent' },
        { unified: 'country', vercel: 'geo_country' },
        { unified: 'city', vercel: 'geo_city' },
        { unified: 'asn', vercel: 'geo_as_number' },
        { unified: 'scheme', vercel: 'scheme' },
      ] as const

      for (const { unified, vercel } of mappings) {
        const rule = makeUnifiedRule({
          conditions: [{ field: unified, operator: 'eq', value: 'test' }],
        })
        const { result } = RuleTranslator.unifiedToVercel(rule)
        expect(result.conditionGroup[0]!.conditions[0]!.type).toBe(vercel)
      }
    })

    // Regression test: Vercel-native fields not covered by the renamed-field
    // table above (e.g. `region`, `ja3_digest`) must map back to themselves,
    // not silently collapse to `path` — see mapUnifiedTypeToVercel.
    it('round-trips Vercel-native field types that have no renamed unified counterpart', () => {
      const vercelNativeFields = [
        'target_path',
        'region',
        'protocol',
        'environment',
        'geo_continent',
        'geo_country_region',
        'ja4_digest',
        'ja3_digest',
        'rate_limit_api_id',
      ] as const

      for (const field of vercelNativeFields) {
        const rule = makeUnifiedRule({
          conditions: [{ field, operator: 'eq', value: 'test' }],
        })
        const { result } = RuleTranslator.unifiedToVercel(rule)
        expect(result.conditionGroup[0]!.conditions[0]!.type).toBe(field)
      }
    })

    // Regression test: a condition field with no Vercel equivalent (e.g.
    // Cloudflare-only `referer`/`port`) must be dropped with a warning, never
    // silently mislabeled as `path`.
    it('drops a condition with no Vercel equivalent and warns instead of defaulting to path', () => {
      const rule = makeUnifiedRule({
        conditions: [
          { field: 'referer', operator: 'eq', value: 'https://example.com' },
          { field: 'path', operator: 'eq', value: '/api' },
        ],
      })
      const { result, warnings } = RuleTranslator.unifiedToVercel(rule)

      expect(result.conditionGroup[0]!.conditions).toHaveLength(1)
      expect(result.conditionGroup[0]!.conditions[0]!.type).toBe('path')
      expect(warnings.some((w) => w.severity === 'critical' && w.field === 'referer')).toBe(true)
    })

    // Regression test: if every condition on a rule is unsupported by Vercel,
    // there's nothing safe to drop down to — this must fail loudly rather
    // than sync a rule with zero conditions (which would match everything).
    it('throws when no condition on the rule has a Vercel equivalent', () => {
      const rule = makeUnifiedRule({
        conditions: [{ field: 'referer', operator: 'eq', value: 'https://example.com' }],
      })

      expect(() => RuleTranslator.unifiedToVercel(rule)).toThrow(/no conditions Vercel can represent/)
    })

    // Regression test: multi-group round-trip fidelity. A rule translated
    // from Vercel with 2 groups (group 0: path AND method; group 1: a
    // single header condition) must come back out as 2 distinct Vercel
    // condition groups, not one flattened group — flattening would turn
    // "(path=/api AND method=POST) OR (header=x)" into
    // "path=/api AND method=POST AND header=x", a different rule.
    it('rebuilds multiple Vercel condition groups from the group index', () => {
      const rule = makeUnifiedRule({
        conditions: [
          { field: 'path', operator: 'eq', value: '/api', group: 0 },
          { field: 'method', operator: 'eq', value: 'POST', group: 0 },
          { field: 'header', operator: 'eq', value: 'x', key: 'X-Custom', group: 1 },
        ],
      })

      const { result } = RuleTranslator.unifiedToVercel(rule)

      expect(result.conditionGroup).toHaveLength(2)
      expect(result.conditionGroup[0]!.conditions).toHaveLength(2)
      expect(result.conditionGroup[1]!.conditions).toHaveLength(1)
      expect(result.conditionGroup[1]!.conditions[0]!.key).toBe('X-Custom')
    })

    // Regression test: if every condition in one group is unmappable but
    // another group has representable conditions, only the empty group is
    // dropped (that OR-branch just doesn't exist in the output) — the rule
    // as a whole still syncs rather than throwing.
    it('drops only the group whose conditions are all unmappable, keeping the rest', () => {
      const rule = makeUnifiedRule({
        conditions: [
          { field: 'referer', operator: 'eq', value: 'https://example.com', group: 0 },
          { field: 'path', operator: 'eq', value: '/api', group: 1 },
        ],
      })

      const { result, warnings } = RuleTranslator.unifiedToVercel(rule)

      expect(result.conditionGroup).toHaveLength(1)
      expect(result.conditionGroup[0]!.conditions[0]!.type).toBe('path')
      expect(warnings.some((w) => w.field === 'referer')).toBe(true)
    })

    it('translates rate_limit action', () => {
      const rule = makeUnifiedRule({
        action: {
          type: 'rate_limit',
          rateLimit: { requests: 50, window: '30s', characteristics: ['ip.src'] },
        },
      })
      const { result } = RuleTranslator.unifiedToVercel(rule)
      expect(result.action.mitigate.action).toBe('rate_limit')
      expect(result.action.mitigate.rateLimit).toMatchObject({ requests: 50, window: '30s' })
    })

    it('translates redirect action', () => {
      const rule = makeUnifiedRule({
        action: {
          type: 'redirect',
          redirect: { location: '/new', permanent: false },
        },
      })
      const { result } = RuleTranslator.unifiedToVercel(rule)
      expect(result.action.mitigate.action).toBe('redirect')
      expect(result.action.mitigate.redirect).toMatchObject({ location: '/new', permanent: false })
    })

    it('sets null for rateLimit and redirect when not present', () => {
      const rule = makeUnifiedRule()
      const { result } = RuleTranslator.unifiedToVercel(rule)
      expect(result.action.mitigate.rateLimit).toBeNull()
      expect(result.action.mitigate.redirect).toBeNull()
    })
  })

  describe('cloudflareToUnified', () => {
    it('translates a basic block rule, parsing the expression back into structured conditions', () => {
      const cfRule = makeCloudflareRule()
      const { result, warnings } = RuleTranslator.cloudflareToUnified(cfRule)

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
      const { result, warnings } = RuleTranslator.cloudflareToUnified(cfRule)

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
        const { result } = RuleTranslator.cloudflareToUnified(rule)
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
      const { result } = RuleTranslator.cloudflareToUnified(rule)
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
      const { result } = RuleTranslator.cloudflareToUnified(rule)
      expect(result.name).toBe(`Rule ${rule.id}`)
    })

    it('defaults enabled to true when not specified', () => {
      const rule = makeCloudflareRule({ enabled: undefined })
      const { result } = RuleTranslator.cloudflareToUnified(rule)
      expect(result.enabled).toBe(true)
    })
  })

  describe('unifiedToCloudflare', () => {
    it('translates a basic deny rule', () => {
      const unified = makeUnifiedRule()
      const { result } = RuleTranslator.unifiedToCloudflare(unified)

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
        const { result } = RuleTranslator.unifiedToCloudflare(rule)
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
      const { result } = RuleTranslator.unifiedToCloudflare(rule)
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
      const { result } = RuleTranslator.unifiedToCloudflare(rule)
      expect(result.ratelimit!.characteristics).toEqual(['ip.src'])
    })

    it('defaults mitigation_timeout to 3600 when not specified', () => {
      const rule = makeUnifiedRule({
        action: {
          type: 'rate_limit',
          rateLimit: { requests: 10, window: '60s' },
        },
      })
      const { result } = RuleTranslator.unifiedToCloudflare(rule)
      expect(result.ratelimit!.mitigation_timeout).toBe(3600)
    })

    it('uses rule name as description fallback', () => {
      const rule = makeUnifiedRule({ description: undefined })
      const { result } = RuleTranslator.unifiedToCloudflare(rule)
      expect(result.description).toBe('Test Rule')
    })
  })

  describe('vercelToCloudflare', () => {
    it('translates a basic deny rule', () => {
      const vercelRule = makeVercelRule()
      const { result } = RuleTranslator.vercelToCloudflare(vercelRule)

      expect(result.action).toBe('block')
      expect(result.expression).toBe('http.request.uri.path eq "/api"')
      expect(result.description).toBe('A test rule')
      expect(result.enabled).toBe(true)
    })

    it('maps Vercel actions to Cloudflare actions', () => {
      const actionMappings: Array<{ vercel: string; cf: string }> = [
        { vercel: 'log', cf: 'log' },
        { vercel: 'deny', cf: 'block' },
        { vercel: 'challenge', cf: 'managed_challenge' },
        { vercel: 'bypass', cf: 'skip' },
        { vercel: 'rate_limit', cf: 'block' },
        { vercel: 'redirect', cf: 'redirect' },
      ]

      for (const { vercel, cf } of actionMappings) {
        const rule = makeVercelRule({
          action: { mitigate: { action: vercel as any } },
        })
        const { result } = RuleTranslator.vercelToCloudflare(rule)
        expect(result.action).toBe(cf)
      }
    })

    it('translates rate_limit with ratelimit config', () => {
      const rule = makeVercelRule({
        action: {
          mitigate: {
            action: 'rate_limit',
            rateLimit: {
              requests: 100,
              window: '1m',
              characteristics: ['ip.src'],
              mitigationTimeout: 600,
              countingExpression: 'true',
            },
          },
        },
      })
      const { result } = RuleTranslator.vercelToCloudflare(rule)
      expect(result.ratelimit).toMatchObject({
        characteristics: ['ip.src'],
        period: 60,
        requests_per_period: 100,
        mitigation_timeout: 600,
        counting_expression: 'true',
      })
    })

    it('translates redirect with action_parameters', () => {
      const rule = makeVercelRule({
        action: {
          mitigate: {
            action: 'redirect',
            redirect: { location: 'https://example.com/new', permanent: true },
          },
        },
      })
      const { result } = RuleTranslator.vercelToCloudflare(rule)
      expect(result.action).toBe('redirect')
      expect(result.action_parameters).toMatchObject({
        from_value: {
          status_code: 301,
          target_url: { value: 'https://example.com/new' },
        },
      })
    })

    it('uses 302 for non-permanent redirects', () => {
      const rule = makeVercelRule({
        action: {
          mitigate: {
            action: 'redirect',
            redirect: { location: 'https://example.com/new', permanent: false },
          },
        },
      })
      const { result } = RuleTranslator.vercelToCloudflare(rule)
      expect((result.action_parameters as any).from_value.status_code).toBe(302)
    })

    it('generates warning when rate limit has no mitigationTimeout', () => {
      const rule = makeVercelRule({
        action: {
          mitigate: {
            action: 'rate_limit',
            rateLimit: { requests: 10, window: '60s' },
          },
        },
      })
      const { warnings } = RuleTranslator.vercelToCloudflare(rule)
      expect(warnings.length).toBeGreaterThan(0)
    })
  })

  describe('cloudflareToVercel', () => {
    it('translates a basic block rule, parsing the expression back into structured conditions', () => {
      const cfRule = makeCloudflareRule()
      const { result, warnings } = RuleTranslator.cloudflareToVercel(cfRule)

      expect(result.id).toBe('cf-rule-1')
      expect(result.name).toBe('A test rule')
      expect(result.active).toBe(true)
      expect(result.action.mitigate.action).toBe('deny')
      expect(result.conditionGroup).toEqual([{ conditions: [{ type: 'path', op: 'eq', value: '/api' }] }])
      // A successfully-parsed expression gets no lossy-conversion warning.
      expect(warnings).toEqual([])
    })

    it('falls back to an empty condition group with a lossy-conversion warning when the expression cannot be parsed', () => {
      const cfRule = makeCloudflareRule({ expression: 'http.request.body.raw contains "x"' })
      const { result, warnings } = RuleTranslator.cloudflareToVercel(cfRule)

      expect(result.conditionGroup).toEqual([{ conditions: [] }])
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings.some((w) => w.category === 'lossy_conversion')).toBe(true)
    })

    it('maps Cloudflare actions to Vercel actions', () => {
      const actionMappings: Array<{ cf: CloudflareRule['action']; vercel: string }> = [
        { cf: 'block', vercel: 'deny' },
        { cf: 'challenge', vercel: 'challenge' },
        { cf: 'managed_challenge', vercel: 'challenge' },
        { cf: 'js_challenge', vercel: 'challenge' },
        { cf: 'log', vercel: 'log' },
        { cf: 'skip', vercel: 'bypass' },
        { cf: 'allow', vercel: 'bypass' },
        { cf: 'redirect', vercel: 'redirect' },
      ]

      for (const { cf, vercel } of actionMappings) {
        const rule = makeCloudflareRule({ action: cf })
        const { result } = RuleTranslator.cloudflareToVercel(rule)
        expect(result.action.mitigate.action).toBe(vercel)
      }
    })

    it('defaults enabled to true when not specified', () => {
      const rule = makeCloudflareRule({ enabled: undefined })
      const { result } = RuleTranslator.cloudflareToVercel(rule)
      expect(result.active).toBe(true)
    })
  })

  describe('vercelIPToUnified', () => {
    it('translates a Vercel IP blocking rule to unified format', () => {
      const ip: VercelIPBlockingRule = {
        id: 'ip-1',
        ip: '192.168.1.1',
        hostname: 'example.com',
        notes: 'Blocked IP',
        action: 'deny',
      }
      const result = RuleTranslator.vercelIPToUnified(ip)
      expect(result).toEqual({
        id: 'ip-1',
        ip: '192.168.1.1',
        hostname: 'example.com',
        notes: 'Blocked IP',
        action: 'deny',
      })
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
      const result = RuleTranslator.unifiedIPToCloudflare(ip)
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
      const result = RuleTranslator.unifiedIPToCloudflare(ip)
      expect(result.action).toBe('allow')
      expect(result.expression).toBe('ip.src eq 10.0.0.2')
    })

    it('includes hostname in description when present', () => {
      const ip: UnifiedIPRule = {
        ip: '10.0.0.1',
        hostname: 'server.example.com',
        action: 'deny',
      }
      const result = RuleTranslator.unifiedIPToCloudflare(ip)
      expect(result.description).toContain('server.example.com')
    })

    it('generates description without hostname when not present', () => {
      const ip: UnifiedIPRule = {
        ip: '10.0.0.1',
        action: 'deny',
      }
      const result = RuleTranslator.unifiedIPToCloudflare(ip)
      expect(result.description).toContain('IP deny: 10.0.0.1')
      expect(result.description).not.toContain('(')
    })

    it('translates a CIDR range using the `in` set operator, not `eq` (regression test for #86)', () => {
      const ip: UnifiedIPRule = { ip: '203.0.113.0/24', action: 'deny' }
      const result = RuleTranslator.unifiedIPToCloudflare(ip)
      // wirefilter's `eq` only matches a single IP literal — a CIDR range
      // needs `in {…}` or Cloudflare's ruleset API rejects the rule.
      expect(result.expression).toBe('ip.src in {203.0.113.0/24}')
    })

    it('still uses `eq` for a single (non-CIDR) IP', () => {
      const ip: UnifiedIPRule = { ip: '203.0.113.5', action: 'deny' }
      const result = RuleTranslator.unifiedIPToCloudflare(ip)
      expect(result.expression).toBe('ip.src eq 203.0.113.5')
    })

    it('rejects an IP value that would inject additional wirefilter syntax', () => {
      const ip: UnifiedIPRule = { ip: '1.2.3.4 or (true) or ip.src eq 1.2.3.4', action: 'deny' }
      expect(() => RuleTranslator.unifiedIPToCloudflare(ip)).toThrow('Invalid IP address or CIDR range')
    })
  })

  describe('window parsing (via vercelToCloudflare rate_limit)', () => {
    it('parses seconds', () => {
      const rule = makeVercelRule({
        action: { mitigate: { action: 'rate_limit', rateLimit: { requests: 10, window: '60s' } } },
      })
      const { result } = RuleTranslator.vercelToCloudflare(rule)
      expect(result.ratelimit!.period).toBe(60)
    })

    it('parses minutes', () => {
      const rule = makeVercelRule({
        action: { mitigate: { action: 'rate_limit', rateLimit: { requests: 10, window: '5m' } } },
      })
      const { result } = RuleTranslator.vercelToCloudflare(rule)
      expect(result.ratelimit!.period).toBe(300)
    })

    it('parses hours', () => {
      const rule = makeVercelRule({
        action: { mitigate: { action: 'rate_limit', rateLimit: { requests: 10, window: '1h' } } },
      })
      const { result } = RuleTranslator.vercelToCloudflare(rule)
      expect(result.ratelimit!.period).toBe(3600)
    })

    it('parses days', () => {
      const rule = makeVercelRule({
        action: { mitigate: { action: 'rate_limit', rateLimit: { requests: 10, window: '1d' } } },
      })
      const { result } = RuleTranslator.vercelToCloudflare(rule)
      expect(result.ratelimit!.period).toBe(86400)
    })
  })
})
