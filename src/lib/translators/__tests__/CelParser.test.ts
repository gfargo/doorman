import { parseCelExpression } from '../CelParser'
import { CelExpressionBuilder } from '../CelExpressionBuilder'
import type { UnifiedCondition } from '../../types/unified'

describe('parseCelExpression', () => {
  it('parses a single simple comparison', () => {
    const result = parseCelExpression("request.path == '/api'")

    expect(result).not.toBeNull()
    expect(result!.conditions).toHaveLength(1)
    expect(result!.conditions[0]).toMatchObject({ field: 'path', operator: 'eq', value: '/api' })
    expect(result!.conditionLogic).toBe('AND')
  })

  it('omits group on an ungrouped condition rather than defaulting it to 0 (regression guard)', () => {
    // A single implicit group carries no information in `group` — a real
    // local config never sets it for the common ungrouped case, so an
    // unconditional `group: 0` here would make isDeepEqual see an extra key
    // that isn't there locally and report a phantom "changed" on every
    // sync. See translator.ts's gcpToUnified for the same fix applied one
    // level up (rateLimit/redirect/conditionLogic).
    const result = parseCelExpression("request.path == '/api'")
    expect(result!.conditions[0]!.group).toBeUndefined()
    expect(Object.keys(result!.conditions[0]!)).not.toContain('group')
  })

  it('parses a flat AND of multiple conditions into a single group', () => {
    const result = parseCelExpression("(request.path == '/api' && request.method == 'POST')")

    expect(result).not.toBeNull()
    expect(result!.conditionLogic).toBe('AND')
    expect(result!.conditions).toHaveLength(2)
    expect(result!.conditions.every((c) => c.group === undefined)).toBe(true)
  })

  it('parses a flat OR of single-condition groups, one group per branch', () => {
    const result = parseCelExpression("(request.path == '/api' || request.path == '/admin')")

    expect(result).not.toBeNull()
    expect(result!.conditionLogic).toBe('OR')
    expect(result!.conditions).toHaveLength(2)
    expect(result!.conditions[0]).toMatchObject({ field: 'path', value: '/api', group: 0 })
    expect(result!.conditions[1]).toMatchObject({ field: 'path', value: '/admin', group: 1 })
  })

  it('parses a numeric comparison', () => {
    const result = parseCelExpression('origin.asn == 15169')
    expect(result!.conditions[0]).toMatchObject({ field: 'asn', operator: 'eq', value: 15169 })
  })

  it('parses gt/ge/lt/le', () => {
    expect(parseCelExpression('origin.asn > 1000')!.conditions[0]).toMatchObject({ operator: 'gt', value: 1000 })
    expect(parseCelExpression('origin.asn >= 1000')!.conditions[0]).toMatchObject({ operator: 'ge', value: 1000 })
    expect(parseCelExpression('origin.asn < 1000')!.conditions[0]).toMatchObject({ operator: 'lt', value: 1000 })
    expect(parseCelExpression('origin.asn <= 1000')!.conditions[0]).toMatchObject({ operator: 'le', value: 1000 })
  })

  it('parses an "in" list into an array value', () => {
    const result = parseCelExpression("request.method in ['GET', 'POST']")
    expect(result!.conditions[0]).toMatchObject({ field: 'method', operator: 'in', value: ['GET', 'POST'] })
  })

  it('parses a negated "in" list as not_in', () => {
    const result = parseCelExpression("!(request.method in ['GET', 'POST'])")
    expect(result!.conditions[0]).toMatchObject({ field: 'method', operator: 'not_in', value: ['GET', 'POST'] })
  })

  describe('has()-guarded (header-backed) conditions', () => {
    it('parses a guarded host comparison', () => {
      const result = parseCelExpression("(has(request.headers['host']) && request.headers['host'] == 'example.com')")
      expect(result!.conditions[0]).toMatchObject({ field: 'host', operator: 'eq', value: 'example.com' })
    })

    it('parses a guarded, negated contains as not_contains', () => {
      const result = parseCelExpression(
        "(has(request.headers['user-agent']) && !request.headers['user-agent'].contains('bot'))",
      )
      expect(result!.conditions[0]).toMatchObject({ field: 'user_agent', operator: 'not_contains', value: 'bot' })
    })

    it('parses a bare has() as exists', () => {
      const result = parseCelExpression("has(request.headers['host'])")
      expect(result!.conditions[0]).toMatchObject({ field: 'host', operator: 'exists' })
    })

    it('parses a negated bare has() as not_exists', () => {
      const result = parseCelExpression("!has(request.headers['host'])")
      expect(result!.conditions[0]).toMatchObject({ field: 'host', operator: 'not_exists' })
    })

    it('parses an arbitrary header key as the generic "header" field', () => {
      const result = parseCelExpression(
        "(has(request.headers['x-custom-header']) && request.headers['x-custom-header'] == 'yes')",
      )
      expect(result!.conditions[0]).toMatchObject({ field: 'header', key: 'x-custom-header', value: 'yes' })
    })
  })

  describe('ip', () => {
    it('parses a bare-IP equality', () => {
      const result = parseCelExpression("origin.ip == '203.0.113.9'")
      expect(result!.conditions[0]).toMatchObject({ field: 'ip', operator: 'eq', value: '203.0.113.9' })
    })

    it('parses inIpRange() as an eq condition', () => {
      const result = parseCelExpression("inIpRange(origin.ip, '198.51.100.0/24')")
      expect(result!.conditions[0]).toMatchObject({ field: 'ip', operator: 'eq', value: '198.51.100.0/24' })
    })

    it('parses a negated single inIpRange() as ne', () => {
      const result = parseCelExpression("!inIpRange(origin.ip, '198.51.100.0/24')")
      expect(result!.conditions[0]).toMatchObject({ field: 'ip', operator: 'ne', value: '198.51.100.0/24' })
    })

    it('parses a negated parenthesized bare-IP equality as ne', () => {
      const result = parseCelExpression("!(origin.ip == '203.0.113.9')")
      expect(result!.conditions[0]).toMatchObject({ field: 'ip', operator: 'ne', value: '203.0.113.9' })
    })

    it('parses an OR of ip checks as a single "in" condition with multiple values, not two groups', () => {
      const result = parseCelExpression("(inIpRange(origin.ip, '198.51.100.0/24') || origin.ip == '203.0.113.9')")
      expect(result!.conditions).toHaveLength(1)
      expect(result!.conditions[0]).toMatchObject({
        field: 'ip',
        operator: 'in',
        value: ['198.51.100.0/24', '203.0.113.9'],
      })
    })

    it('parses a negated OR of ip checks as not_in', () => {
      const result = parseCelExpression("!(inIpRange(origin.ip, '198.51.100.0/24') || origin.ip == '203.0.113.9')")
      expect(result!.conditions[0]).toMatchObject({
        field: 'ip',
        operator: 'not_in',
        value: ['198.51.100.0/24', '203.0.113.9'],
      })
    })
  })

  it('decodes escaped quotes and backslashes inside string values', () => {
    const result = parseCelExpression("request.path == '/say \\'hi\\' \\\\ bye'")
    expect(result!.conditions[0]!.value).toBe("/say 'hi' \\ bye")
  })

  it('returns null for an expression with an unmapped field', () => {
    expect(parseCelExpression("request.body.raw.contains('x')")).toBeNull()
  })

  it('returns null for an OR nested inside an AND (a shape CelExpressionBuilder never generates)', () => {
    expect(
      parseCelExpression("request.path == '/api' && (request.method == 'GET' || request.method == 'POST')"),
    ).toBeNull()
  })

  it('returns null for malformed syntax', () => {
    expect(parseCelExpression('request.path ==')).toBeNull()
    expect(parseCelExpression("(request.path == '/api'")).toBeNull()
    expect(parseCelExpression('')).toBeNull()
  })

  describe('round-trip fidelity against CelExpressionBuilder', () => {
    const roundTrip = (conditions: UnifiedCondition[], logic: 'AND' | 'OR' = 'AND') => {
      const expression = CelExpressionBuilder.fromUnifiedConditions(conditions, logic)
      const parsed = parseCelExpression(expression)
      return { expression, parsed }
    }

    it('round-trips a flat single condition', () => {
      const { parsed } = roundTrip([{ field: 'path', operator: 'eq', value: '/api' }])
      expect(parsed).not.toBeNull()
      expect(parsed!.conditions).toHaveLength(1)
      expect(parsed!.conditions[0]).toMatchObject({ field: 'path', operator: 'eq', value: '/api' })
    })

    it('round-trips a flat AND of conditions', () => {
      const { parsed } = roundTrip([
        { field: 'path', operator: 'eq', value: '/api' },
        { field: 'method', operator: 'eq', value: 'POST' },
      ])
      expect(parsed).not.toBeNull()
      expect(parsed!.conditionLogic).toBe('AND')
      expect(parsed!.conditions).toHaveLength(2)
    })

    it('round-trips a multi-group (AND-within/OR-across) condition set', () => {
      const { parsed } = roundTrip([
        { field: 'path', operator: 'eq', value: '/a', group: 0 },
        { field: 'method', operator: 'eq', value: 'POST', group: 0 },
        { field: 'path', operator: 'eq', value: '/b', group: 1 },
      ])
      expect(parsed).not.toBeNull()
      expect(parsed!.conditionLogic).toBe('OR')
      expect(parsed!.conditions).toHaveLength(3)
      expect(parsed!.conditions.filter((c) => c.group === 0)).toHaveLength(2)
      expect(parsed!.conditions.filter((c) => c.group === 1)).toHaveLength(1)
    })

    it('round-trips a not_contains condition on a header-backed field', () => {
      const { parsed } = roundTrip([{ field: 'user_agent', operator: 'not_contains', value: 'bot' }])
      expect(parsed!.conditions[0]).toMatchObject({ field: 'user_agent', operator: 'not_contains', value: 'bot' })
    })

    it('round-trips an arbitrary header condition with a key', () => {
      const { parsed } = roundTrip([{ field: 'header', key: 'x-custom-header', operator: 'eq', value: 'yes' }])
      expect(parsed!.conditions[0]).toMatchObject({ field: 'header', key: 'x-custom-header', value: 'yes' })
    })

    it('round-trips an "in" condition with an array value', () => {
      const { parsed } = roundTrip([{ field: 'method', operator: 'in', value: ['GET', 'HEAD'] }])
      expect(parsed!.conditions[0]).toMatchObject({ field: 'method', operator: 'in', value: ['GET', 'HEAD'] })
    })

    it('round-trips a bare-IP eq condition', () => {
      const { parsed } = roundTrip([{ field: 'ip', operator: 'eq', value: '203.0.113.9' }])
      expect(parsed!.conditions[0]).toMatchObject({ field: 'ip', operator: 'eq', value: '203.0.113.9' })
    })

    it('round-trips a multi-value ip "in" condition', () => {
      const { parsed } = roundTrip([{ field: 'ip', operator: 'in', value: ['198.51.100.0/24', '203.0.113.9'] }])
      expect(parsed!.conditions[0]).toMatchObject({
        field: 'ip',
        operator: 'in',
        value: ['198.51.100.0/24', '203.0.113.9'],
      })
    })

    it('round-trips a negated single ip condition', () => {
      const { parsed } = roundTrip([{ field: 'ip', operator: 'ne', value: '203.0.113.9' }])
      expect(parsed!.conditions[0]).toMatchObject({ field: 'ip', operator: 'ne', value: '203.0.113.9' })
    })

    // A keyed cookie condition is CEL's one inherently lossy case (see
    // CelParser.ts's file-level doc comment) — there is no CEL shape that
    // distinguishes "this specific cookie" from "this substring appears in
    // the header", so it comes back reshaped rather than identical. What
    // matters is that the reshaped condition, fed back through the builder,
    // produces the *same* CEL both times (idempotent from here on) — not
    // that the UnifiedCondition shape matches the original.
    it('round-trips a keyed cookie condition to an equivalent (reshaped, idempotent) contains condition', () => {
      const original: UnifiedCondition = { field: 'cookie', key: 'session', operator: 'eq', value: 'abc123' }
      const firstPass = CelExpressionBuilder.fromUnifiedConditions([original], 'AND')
      const parsed = parseCelExpression(firstPass)

      expect(parsed).not.toBeNull()
      expect(parsed!.conditions[0]).toMatchObject({ field: 'cookie', operator: 'contains', value: 'session=abc123' })

      const secondPass = CelExpressionBuilder.fromUnifiedConditions(parsed!.conditions, parsed!.conditionLogic)
      expect(secondPass).toBe(firstPass)
    })

    it('round-trips a value containing a quote and a backslash', () => {
      const { parsed } = roundTrip([{ field: 'path', operator: 'eq', value: "/it's a\\test" }])
      expect(parsed!.conditions[0]!.value).toBe("/it's a\\test")
    })
  })
})
