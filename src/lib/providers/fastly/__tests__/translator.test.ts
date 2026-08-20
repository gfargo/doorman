import { fastlyToUnified, unifiedToFastly, fastlyListEntriesToUnified, unifiedIPsToFastlyEntries } from '../translator'
import type { FastlyRule } from '../../../types/fastly'
import type { UnifiedRule } from '../../../types/unified'

/**
 * Round-trips a unified rule through `unifiedToFastly` then `fastlyToUnified`,
 * filling in the response-only fields (`id`, `scope`, timestamps) a real
 * Fastly API response would add, the way `providerMocks.ts`'s
 * `fastlyRuleFromInput` does for the service-level tests.
 */
function roundTrip(rule: UnifiedRule): UnifiedRule {
  const { result: input } = unifiedToFastly(rule)
  const fastlyRule: FastlyRule = {
    id: rule.id ?? 'generated-id',
    type: input.type,
    scope: { type: 'workspace', applies_to: ['workspace-1'] },
    enabled: input.enabled,
    description: input.description,
    group_operator: input.group_operator,
    request_logging: input.request_logging ?? 'sampled',
    conditions: [...(input.conditions ?? []), ...(input.group_conditions ?? []), ...(input.multival_conditions ?? [])],
    actions: input.actions,
    rate_limit: input.rate_limit ?? null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
  return fastlyToUnified(fastlyRule).result
}

describe('fastly translator round-trip fidelity', () => {
  it('round-trips a single ungrouped AND rule', () => {
    const rule: UnifiedRule = {
      id: 'r1',
      name: 'Block bad path',
      enabled: true,
      conditionLogic: 'AND',
      conditions: [
        { field: 'path', operator: 'eq', value: '/admin', group: 0 },
        { field: 'method', operator: 'eq', value: 'POST', group: 0 },
      ],
      action: { type: 'block' },
    }

    const result = roundTrip(rule)
    expect(result.conditions).toEqual(rule.conditions)
    expect(result.conditionLogic).toBe('AND')
    expect(result.action).toEqual({ type: 'block' })
  })

  it('round-trips a multi-group OR rule (AND-within-group, OR-across-groups)', () => {
    const rule: UnifiedRule = {
      id: 'r2',
      name: 'Multi-group rule',
      enabled: true,
      conditions: [
        { field: 'country', operator: 'eq', value: 'AD', group: 0 },
        { field: 'method', operator: 'eq', value: 'POST', group: 0 },
        { field: 'method', operator: 'eq', value: 'HEAD', group: 1 },
      ],
      action: { type: 'block' },
    }

    const result = roundTrip(rule)
    expect(result.conditions).toHaveLength(3)
    // Group 0's pair stays together, group 1's single condition is its own group.
    const group0 = result.conditions.filter((c) => c.group === result.conditions[0]!.group)
    expect(group0).toHaveLength(2)
    expect(result.conditionLogic).toBe('OR')
  })

  it('round-trips a negated operator', () => {
    const rule: UnifiedRule = {
      id: 'r3',
      name: 'Not equal',
      enabled: true,
      conditions: [{ field: 'country', operator: 'eq', value: 'US', negated: true, group: 0 }],
      action: { type: 'block' },
    }

    const { result: input } = unifiedToFastly(rule)
    expect(input.conditions?.[0]).toMatchObject({ field: 'country', operator: 'does_not_equal', value: 'US' })

    const result = roundTrip(rule)
    expect(result.conditions[0]).toMatchObject({ field: 'country', operator: 'eq', value: 'US', negated: true })
  })

  it('omits `negated` entirely for a non-negated condition (regression: must not break diffing)', () => {
    const rule: UnifiedRule = {
      id: 'r3b',
      name: 'Plain',
      enabled: true,
      conditions: [{ field: 'path', operator: 'eq', value: '/x', group: 0 }],
      action: { type: 'block' },
    }

    const result = roundTrip(rule)
    expect(Object.prototype.hasOwnProperty.call(result.conditions[0], 'negated')).toBe(false)
  })

  it.each(['header', 'query', 'cookie'] as const)('round-trips a keyed %s condition via a multival block', (field) => {
    const rule: UnifiedRule = {
      id: 'r4',
      name: `Match ${field}`,
      enabled: true,
      conditions: [{ field, operator: 'eq', value: 'expected-value', key: 'X-Test', group: 0 }],
      action: { type: 'block' },
    }

    const { result: input } = unifiedToFastly(rule)
    expect(input.multival_conditions).toHaveLength(1)
    expect(input.conditions).toHaveLength(0)

    const result = roundTrip(rule)
    expect(result.conditions[0]).toMatchObject({ field, operator: 'eq', value: 'expected-value', key: 'X-Test' })
  })

  it('drops a condition field Fastly has no equivalent for, with a warning, rather than mistranslating it', () => {
    const rule: UnifiedRule = {
      id: 'r5',
      name: 'Referer rule',
      enabled: true,
      conditions: [{ field: 'referer', operator: 'eq', value: 'https://example.com', group: 0 }],
      action: { type: 'block' },
    }

    expect(() => unifiedToFastly(rule)).toThrow(/no conditions Fastly can represent/)
  })

  it('drops an unsupported field but keeps a sibling supported one, with a warning', () => {
    const rule: UnifiedRule = {
      id: 'r6',
      name: 'Mixed rule',
      enabled: true,
      conditions: [
        { field: 'referer', operator: 'eq', value: 'https://example.com', group: 0 },
        { field: 'path', operator: 'eq', value: '/x', group: 0 },
      ],
      action: { type: 'block' },
    }

    const { result, warnings } = unifiedToFastly(rule)
    expect(result.conditions).toHaveLength(1)
    expect(result.conditions?.[0]).toMatchObject({ field: 'path' })
    expect(warnings.some((w) => w.message.includes('referer'))).toBe(true)
  })

  it('round-trips a redirect action', () => {
    const rule: UnifiedRule = {
      id: 'r7',
      name: 'Redirect rule',
      enabled: true,
      conditions: [{ field: 'path', operator: 'eq', value: '/old', group: 0 }],
      action: { type: 'redirect', redirect: { location: 'https://example.com/new', statusCode: 301 } },
    }

    const result = roundTrip(rule)
    expect(result.action).toEqual({
      type: 'redirect',
      redirect: { location: 'https://example.com/new', statusCode: 301 },
    })
  })

  it('builds a rate_limit rule type with a rate_limit block', () => {
    const rule: UnifiedRule = {
      id: 'r8',
      name: 'Rate limit rule',
      enabled: true,
      conditions: [{ field: 'ip', operator: 'eq', value: '1.2.3.4', group: 0 }],
      action: { type: 'rate_limit', rateLimit: { requests: 100, window: '60s' } },
    }

    const { result: input } = unifiedToFastly(rule)
    expect(input.type).toBe('rate_limit')
    expect(input.rate_limit).toMatchObject({ threshold: 100, interval: 60 })

    const result = roundTrip(rule)
    expect(result.action.type).toBe('rate_limit')
    expect(result.action.rateLimit?.requests).toBe(100)
  })

  it('rounds a non-standard rate-limit window to the nearest Fastly-supported interval', () => {
    const rule: UnifiedRule = {
      id: 'r9',
      name: 'Odd window',
      enabled: true,
      conditions: [{ field: 'ip', operator: 'eq', value: '1.2.3.4', group: 0 }],
      action: { type: 'rate_limit', rateLimit: { requests: 10, window: '9m' } },
    }

    const { result: input, warnings } = unifiedToFastly(rule)
    expect(input.rate_limit?.interval).toBe(600)
    expect(warnings.some((w) => w.message.includes('interval'))).toBe(true)
  })

  it('throws when a rule has no conditions Fastly can represent at all', () => {
    const rule: UnifiedRule = {
      id: 'r10',
      name: 'Empty',
      enabled: true,
      conditions: [],
      action: { type: 'block' },
    }

    expect(() => unifiedToFastly(rule)).toThrow(/no conditions Fastly can represent/)
  })

  it('skips a signal/exclude_signal action with a warning, mapping it to "log"', () => {
    const fastlyRule: FastlyRule = {
      id: 'r11',
      type: 'request',
      scope: { type: 'workspace', applies_to: ['workspace-1'] },
      enabled: true,
      description: 'Exclude a false positive',
      group_operator: 'all',
      request_logging: 'sampled',
      conditions: [{ type: 'single', field: 'path', operator: 'equals', value: '/x' }],
      actions: [{ type: 'exclude_signal', signal: 'XSS' }],
      rate_limit: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }

    const { result, warnings } = fastlyToUnified(fastlyRule)
    expect(result.action.type).toBe('log')
    expect(warnings.some((w) => w.message.includes('exclude_signal'))).toBe(true)
  })
})

describe('fastly IP list translation', () => {
  it('translates list entries to unified IP rules by action', () => {
    expect(fastlyListEntriesToUnified(['1.2.3.4', '5.6.7.8'], 'deny')).toEqual([
      { ip: '1.2.3.4', action: 'deny' },
      { ip: '5.6.7.8', action: 'deny' },
    ])
  })

  it('splits unified IP rules into deny/allow entry lists', () => {
    const { result } = unifiedIPsToFastlyEntries([
      { ip: '1.2.3.4', action: 'deny' },
      { ip: '5.6.7.8', action: 'allow' },
    ])
    expect(result.denyEntries).toEqual(['1.2.3.4'])
    expect(result.allowEntries).toEqual(['5.6.7.8'])
  })

  it('warns and drops hostname/notes, which have no Fastly list equivalent', () => {
    const { result, warnings } = unifiedIPsToFastlyEntries([
      { ip: '1.2.3.4', action: 'deny', hostname: 'example.com', notes: 'known bad actor' },
    ])
    expect(result.denyEntries).toEqual(['1.2.3.4'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toMatch(/hostname.*notes/)
  })
})
