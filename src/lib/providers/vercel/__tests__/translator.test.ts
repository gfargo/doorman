jest.mock('../../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { vercelToUnified, unifiedToVercel, vercelIPToUnified } from '../translator'
import type { VercelCustomRule, VercelIPBlockingRule } from '../../../types/vercel'
import type { UnifiedRule } from '../../../types/unified'

// Split out of the former RuleTranslator.test.ts as part of #196 — this
// covers exactly the Vercel <-> Unified directions now living in ../translator.

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

describe('vercel/translator', () => {
  describe('vercelToUnified', () => {
    it('translates a basic deny rule', () => {
      const vercelRule = makeVercelRule()
      const { result } = vercelToUnified(vercelRule)

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
        const { result } = vercelToUnified(rule)
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
        // #273 Bug 1: Vercel's `region` (edge/deployment location) must NOT
        // become unified `region` — that name is already taken by a
        // different concept (client geo subdivision). Namespaced instead.
        { vercel: 'region', unified: 'vercel_region' },
        // #273: Vercel's `geo_country_region` ("Region/state code", e.g.
        // "CA") is the *same* concept as unified `region`, unlike the case
        // above — it gets the real name, not a pass-through or a namespace.
        { vercel: 'geo_country_region', unified: 'region' },
      ] as const

      for (const { vercel, unified } of mappings) {
        const rule = makeVercelRule({
          conditionGroup: [{ conditions: [{ type: vercel, op: 'eq', value: 'test' }] }],
        })
        const { result } = vercelToUnified(rule)
        expect(result.conditions[0]!.field).toBe(unified)
      }
    })

    // Regression test for #273 Bug 1: this is the exact collision the bug
    // report found — Vercel's `region` must never survive vercelToUnified as
    // literal unified field `"region"`, because that's already the name of a
    // different, real FieldType (client geo subdivision, see common.ts) that
    // Cloudflare's translator maps to `ip.geoip.subdivision_1`. Asserted
    // separately from the table above so this specific regression can't be
    // silently deleted by future table edits without failing loudly.
    it('never lets a Vercel region condition collide with the unified region field', () => {
      const rule = makeVercelRule({
        conditionGroup: [{ conditions: [{ type: 'region', op: 'eq', value: 'sfo1' }] }],
      })
      const { result } = vercelToUnified(rule)
      expect(result.conditions[0]!.field).not.toBe('region')
      expect(result.conditions[0]!.field).toBe('vercel_region')
    })

    it('preserves negation flag', () => {
      const rule = makeVercelRule({
        conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/api', neg: true }] }],
      })
      const { result } = vercelToUnified(rule)
      expect(result.conditions[0]!.negated).toBe(true)
    })

    it('preserves key for header conditions', () => {
      const rule = makeVercelRule({
        conditionGroup: [{ conditions: [{ type: 'header', op: 'eq', value: 'test', key: 'X-Custom' }] }],
      })
      const { result } = vercelToUnified(rule)
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
      const { result } = vercelToUnified(rule)
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
      const { result } = vercelToUnified(rule)
      expect(result.action.type).toBe('redirect')
      expect(result.action.redirect).toMatchObject({ location: '/new-path', permanent: true })
    })

    it('translates actionDuration to duration', () => {
      const rule = makeVercelRule({
        action: { mitigate: { action: 'deny', actionDuration: '1h' } },
      })
      const { result } = vercelToUnified(rule)
      expect(result.action.duration).toBe('1h')
    })

    // Regression test for #214 — vercelToUnified is the provider-agnostic
    // Vercel-native -> Unified step every command (list/status/diff/backup/
    // sync) runs on every fetch, with no destination provider in play. It
    // previously warned "may need adjustment for target provider" on any
    // regex condition unconditionally, which fired on ordinary single-
    // provider Vercel usage with no migration happening at all — there's no
    // call site today where this result feeds a different provider's
    // unifiedToX translator, so the warning had no target to be about.
    it('does not warn about regex patterns on ordinary (non-migration) translation', () => {
      const rule = makeVercelRule({
        conditionGroup: [{ conditions: [{ type: 'path', op: 're', value: '^/api/v[0-9]+' }] }],
      })
      const { warnings } = vercelToUnified(rule)
      expect(warnings.some((w) => w.category === 'syntax_limitation')).toBe(false)
    })

    it('flattens multiple condition groups', () => {
      const rule = makeVercelRule({
        conditionGroup: [
          { conditions: [{ type: 'path', op: 'eq', value: '/api' }] },
          { conditions: [{ type: 'method', op: 'eq', value: 'POST' }] },
        ],
      })
      const { result } = vercelToUnified(rule)
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
      const { result } = vercelToUnified(rule)

      expect(result.conditions[0]?.group).toBe(0)
      expect(result.conditions[1]?.group).toBe(0)
      expect(result.conditions[2]?.group).toBe(1)
      expect(result.conditionLogic).toBe('OR')
    })
  })

  describe('unifiedToVercel', () => {
    it('translates a basic deny rule', () => {
      const unified = makeUnifiedRule()
      const { result } = unifiedToVercel(unified)

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
        const { result } = unifiedToVercel(rule)
        expect(result.conditionGroup[0]!.conditions[0]!.op).toBe(vercel)
      }
    })

    // Regression tests for #261: `ne`/`not_contains`/`not_in` previously fell
    // through mapUnifiedOperatorToVercel's `mapping[op] || 'eq'` fallback
    // with no warning — silently inverting a rule's intent (e.g. "method is
    // not POST" became "method is POST"). Vercel has no dedicated negative
    // operators for these, only a positive operator + `neg` flag (same
    // mechanism `not_exists` already uses via `nex`), so the fix maps each
    // to its positive Vercel operator with `neg: true` forced on.
    it('maps ne/not_contains/not_in to their positive Vercel operator with neg forced true', () => {
      const ops = [
        { unified: 'ne', vercel: 'eq' },
        { unified: 'not_contains', vercel: 'sub' },
        { unified: 'not_in', vercel: 'inc' },
      ] as const

      for (const { unified, vercel } of ops) {
        const rule = makeUnifiedRule({
          conditions: [{ field: 'path', operator: unified, value: 'test' }],
        })
        const { result } = unifiedToVercel(rule)
        const condition = result.conditionGroup[0]!.conditions[0]!
        expect(condition.op).toBe(vercel)
        expect(condition.neg).toBe(true)
      }
    })

    it('composes a negated ne condition (double negation) back to a plain, non-negated eq', () => {
      // `ne` already means "not equal"; `negated: true` on top of that means
      // "NOT (not equal)" = "equal" — the two negations must cancel (XOR),
      // not stack into a nonsensical `neg: true` re-affirmation.
      const rule = makeUnifiedRule({
        conditions: [{ field: 'path', operator: 'ne', value: 'test', negated: true }],
      })
      const { result } = unifiedToVercel(rule)
      const condition = result.conditionGroup[0]!.conditions[0]!
      expect(condition.op).toBe('eq')
      expect(condition.neg).toBe(false)
    })

    it('still honors negated on an already-working operator exactly as before (eq + negated -> neg: true)', () => {
      const rule = makeUnifiedRule({
        conditions: [{ field: 'path', operator: 'eq', value: 'test', negated: true }],
      })
      const { result } = unifiedToVercel(rule)
      const condition = result.conditionGroup[0]!.conditions[0]!
      expect(condition.op).toBe('eq')
      expect(condition.neg).toBe(true)
    })

    // Regression tests for #261: gt/ge/lt/le have no Vercel equivalent at
    // all (Vercel's operator vocabulary has no numeric-comparison concept),
    // so — unlike ne/not_contains/not_in above — there's no positive-operator
    // fallback to map to. The condition must be dropped with a critical
    // warning, not silently mis-mapped to eq.
    it('drops a numeric-comparison condition (gt/ge/lt/le) and warns instead of defaulting to eq', () => {
      const numericOps = ['gt', 'ge', 'lt', 'le'] as const

      for (const op of numericOps) {
        // `asn` (-> Vercel's geo_as_number) has a real Vercel field mapping,
        // unlike Cloudflare-only fields like `port` — this must fail on the
        // *operator*, not get dropped earlier for having no Vercel field at
        // all (which would happen for `port` and not exercise this path).
        const rule = makeUnifiedRule({
          conditions: [
            { field: 'asn', operator: op, value: 13335 },
            { field: 'path', operator: 'eq', value: '/api' },
          ],
        })
        const { result, warnings } = unifiedToVercel(rule)

        expect(result.conditionGroup[0]!.conditions).toHaveLength(1)
        expect(result.conditionGroup[0]!.conditions[0]!.type).toBe('path')
        expect(warnings.some((w) => w.severity === 'critical' && w.message.includes(op))).toBe(true)
      }
    })

    it('throws when the only condition on the rule uses an unsupported operator', () => {
      const rule = makeUnifiedRule({
        conditions: [{ field: 'path', operator: 'gt', value: 1024 }],
      })

      expect(() => unifiedToVercel(rule)).toThrow(/no conditions Vercel can represent/)
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
        const { result } = unifiedToVercel(rule)
        expect(result.conditionGroup[0]!.conditions[0]!.type).toBe(vercel)
      }
    })

    // Regression test: Vercel-native fields not covered by the renamed-field
    // table above (e.g. `region`, `ja3_digest`) must map back to themselves,
    // not silently collapse to `path` — see mapUnifiedTypeToVercel.
    it('round-trips Vercel-native field types that have no renamed unified counterpart', () => {
      const vercelNativeFields = [
        'target_path',
        'protocol',
        'environment',
        'geo_continent',
        'ja4_digest',
        'ja3_digest',
        'rate_limit_api_id',
      ] as const

      for (const field of vercelNativeFields) {
        const rule = makeUnifiedRule({
          conditions: [{ field, operator: 'eq', value: 'test' }],
        })
        const { result } = unifiedToVercel(rule)
        expect(result.conditionGroup[0]!.conditions[0]!.type).toBe(field)
      }
    })

    // Regression test for #273 Bug 1: unified `region` (client geo
    // subdivision, e.g. Cloudflare's `ip.geoip.subdivision_1`) must map to
    // Vercel's `geo_country_region` — the field that actually represents
    // that concept on Vercel — not to Vercel's own `region` (edge/deployment
    // location, a different concept that happens to share the name).
    it('maps unified region (client geo) to Vercel geo_country_region, not Vercel region', () => {
      const rule = makeUnifiedRule({
        conditions: [{ field: 'region', operator: 'eq', value: 'CA' }],
      })
      const { result } = unifiedToVercel(rule)
      expect(result.conditionGroup[0]!.conditions[0]!.type).toBe('geo_country_region')
    })

    // Regression test for #273 Bug 1: the Vercel-namespaced `vercel_region`
    // unified field (see vercelToUnified tests below) must round-trip back
    // to Vercel's native `region` type.
    it('maps unified vercel_region back to Vercel region', () => {
      const rule = makeUnifiedRule({
        conditions: [{ field: 'vercel_region', operator: 'eq', value: 'sfo1' }],
      })
      const { result } = unifiedToVercel(rule)
      expect(result.conditionGroup[0]!.conditions[0]!.type).toBe('region')
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
      const { result, warnings } = unifiedToVercel(rule)

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

      expect(() => unifiedToVercel(rule)).toThrow(/no conditions Vercel can represent/)
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

      const { result } = unifiedToVercel(rule)

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

      const { result, warnings } = unifiedToVercel(rule)

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
      const { result } = unifiedToVercel(rule)
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
      const { result } = unifiedToVercel(rule)
      expect(result.action.mitigate.action).toBe('redirect')
      expect(result.action.mitigate.redirect).toMatchObject({ location: '/new', permanent: false })
    })

    it('sets null for rateLimit and redirect when not present', () => {
      const rule = makeUnifiedRule()
      const { result } = unifiedToVercel(rule)
      expect(result.action.mitigate.rateLimit).toBeNull()
      expect(result.action.mitigate.redirect).toBeNull()
    })

    // Regression coverage for #180: UnifiedAction.response was declared in
    // the public type and unified schema but had zero consumers anywhere.
    // Vercel has no custom-response-body concept at all, so this must warn
    // rather than silently drop it.
    it('warns that a custom response is unsupported when translating to Vercel', () => {
      const rule = makeUnifiedRule({ action: { type: 'deny', response: { content: 'Denied' } } })
      const { warnings } = unifiedToVercel(rule)

      expect(warnings.some((w) => w.field === 'action.response')).toBe(true)
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
      const result = vercelIPToUnified(ip)
      expect(result).toEqual({
        id: 'ip-1',
        ip: '192.168.1.1',
        hostname: 'example.com',
        notes: 'Blocked IP',
        action: 'deny',
      })
    })
  })
})
