import { parseWirefilterExpression } from '../WirefilterParser'
import { ExpressionBuilder } from '../ExpressionBuilder'
import type { UnifiedCondition } from '../../types/unified'

describe('parseWirefilterExpression', () => {
  it('parses a single simple comparison', () => {
    const result = parseWirefilterExpression('http.request.uri.path eq "/api"')

    expect(result).not.toBeNull()
    expect(result!.conditions).toHaveLength(1)
    expect(result!.conditions[0]).toMatchObject({ field: 'path', operator: 'eq', value: '/api', group: 0 })
    expect(result!.conditionLogic).toBe('AND')
  })

  it('parses a flat AND of multiple conditions into a single group', () => {
    const result = parseWirefilterExpression('(http.request.uri.path eq "/api" and http.request.method eq "POST")')

    expect(result).not.toBeNull()
    expect(result!.conditionLogic).toBe('AND')
    expect(result!.conditions).toHaveLength(2)
    expect(result!.conditions.every((c) => c.group === 0)).toBe(true)
    expect(result!.conditions[0]).toMatchObject({ field: 'path', operator: 'eq', value: '/api' })
    expect(result!.conditions[1]).toMatchObject({ field: 'method', operator: 'eq', value: 'POST' })
  })

  it('parses a flat OR of single-condition groups, one group per branch', () => {
    const result = parseWirefilterExpression('(http.request.uri.path eq "/api" or http.request.uri.path eq "/admin")')

    expect(result).not.toBeNull()
    expect(result!.conditionLogic).toBe('OR')
    expect(result!.conditions).toHaveLength(2)
    expect(result!.conditions[0]).toMatchObject({ field: 'path', value: '/api', group: 0 })
    expect(result!.conditions[1]).toMatchObject({ field: 'path', value: '/admin', group: 1 })
  })

  it('parses a top-level OR with no enclosing parens (matches ExpressionBuilder.fromVercelConditionGroups output)', () => {
    const result = parseWirefilterExpression(
      '(http.request.uri.path eq "/a" and http.request.method eq "POST") or http.request.uri.path eq "/b"',
    )

    expect(result).not.toBeNull()
    expect(result!.conditionLogic).toBe('OR')
    expect(result!.conditions).toHaveLength(3)
    const group0 = result!.conditions.filter((c) => c.group === 0)
    const group1 = result!.conditions.filter((c) => c.group === 1)
    expect(group0).toHaveLength(2)
    expect(group1).toHaveLength(1)
    expect(group1[0]).toMatchObject({ field: 'path', value: '/b' })
  })

  it('parses negated comparisons as negated: true for operators with no dedicated "not_X" form', () => {
    const result = parseWirefilterExpression('not (http.request.uri.path eq "/api")')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]).toMatchObject({ field: 'path', operator: 'eq', value: '/api', negated: true })
  })

  it('parses "not (field contains value)" as the dedicated not_contains operator', () => {
    const result = parseWirefilterExpression('not (http.user_agent contains "bot")')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]).toMatchObject({ field: 'user_agent', operator: 'not_contains', value: 'bot' })
    expect(result!.conditions[0]!.negated).toBeUndefined()
  })

  it('parses "not (field in {...})" as the dedicated not_in operator', () => {
    const result = parseWirefilterExpression('not (http.request.method in {"GET" "HEAD"})')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]).toMatchObject({ field: 'method', operator: 'not_in', value: ['GET', 'HEAD'] })
  })

  it('parses "field exists" and its negation', () => {
    const exists = parseWirefilterExpression('http.referer exists')
    expect(exists!.conditions[0]).toMatchObject({ field: 'referer', operator: 'exists' })

    const notExists = parseWirefilterExpression('not (http.referer exists)')
    expect(notExists!.conditions[0]).toMatchObject({ field: 'referer', operator: 'not_exists' })
  })

  it('parses header bracket-key field references', () => {
    const result = parseWirefilterExpression('http.request.headers["X-Custom"] eq "value"')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]).toMatchObject({ field: 'header', key: 'X-Custom', operator: 'eq', value: 'value' })
  })

  it('parses cookie bracket-key field references', () => {
    const result = parseWirefilterExpression('http.cookie["session"] eq "abc123"')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]).toMatchObject({ field: 'cookie', key: 'session', operator: 'eq', value: 'abc123' })
  })

  it('parses a set literal into an array value', () => {
    const result = parseWirefilterExpression('http.request.uri.path in {"/a" "/b" "/c"}')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]!.value).toEqual(['/a', '/b', '/c'])
  })

  it('parses an unquoted IP literal value', () => {
    const result = parseWirefilterExpression('ip.src eq 1.2.3.4')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]).toMatchObject({ field: 'ip', operator: 'eq', value: '1.2.3.4' })
  })

  it('parses a numeric value', () => {
    const result = parseWirefilterExpression('cf.edge.server_port gt 1024')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]).toMatchObject({ field: 'port', operator: 'gt', value: 1024 })
  })

  it('decodes escaped quotes and backslashes inside string values', () => {
    const result = parseWirefilterExpression('http.request.uri.path eq "/say \\"hi\\" \\\\ bye"')

    expect(result).not.toBeNull()
    expect(result!.conditions[0]!.value).toBe('/say "hi" \\ bye')
  })

  it('returns null for an expression with an unmapped field', () => {
    expect(parseWirefilterExpression('http.request.body.raw contains "x"')).toBeNull()
  })

  it('returns null for an OR nested inside an AND (a shape ExpressionBuilder never generates)', () => {
    expect(
      parseWirefilterExpression('http.request.uri.path eq "/api" and (http.host eq "a" or http.host eq "b")'),
    ).toBeNull()
  })

  it('returns null for malformed syntax', () => {
    expect(parseWirefilterExpression('http.request.uri.path eq')).toBeNull()
    expect(parseWirefilterExpression('(http.request.uri.path eq "/api"')).toBeNull()
    expect(parseWirefilterExpression('')).toBeNull()
  })

  describe('round-trip fidelity against ExpressionBuilder', () => {
    it('round-trips a flat single condition', () => {
      const conditions: UnifiedCondition[] = [{ field: 'path', operator: 'eq', value: '/api' }]
      const expression = ExpressionBuilder.fromUnifiedConditions(conditions, 'AND')

      const parsed = parseWirefilterExpression(expression)

      expect(parsed).not.toBeNull()
      expect(parsed!.conditions).toHaveLength(1)
      expect(parsed!.conditions[0]).toMatchObject({ field: 'path', operator: 'eq', value: '/api' })
    })

    it('round-trips a flat AND of conditions', () => {
      const conditions: UnifiedCondition[] = [
        { field: 'path', operator: 'eq', value: '/api' },
        { field: 'method', operator: 'eq', value: 'POST' },
      ]
      const expression = ExpressionBuilder.fromUnifiedConditions(conditions, 'AND')

      const parsed = parseWirefilterExpression(expression)

      expect(parsed).not.toBeNull()
      expect(parsed!.conditionLogic).toBe('AND')
      expect(parsed!.conditions).toHaveLength(2)
    })

    it('round-trips a multi-group (AND-within/OR-across) condition set', () => {
      const conditions: UnifiedCondition[] = [
        { field: 'path', operator: 'eq', value: '/a', group: 0 },
        { field: 'method', operator: 'eq', value: 'POST', group: 0 },
        { field: 'path', operator: 'eq', value: '/b', group: 1 },
      ]
      const expression = ExpressionBuilder.fromUnifiedConditions(conditions)

      const parsed = parseWirefilterExpression(expression)

      expect(parsed).not.toBeNull()
      expect(parsed!.conditionLogic).toBe('OR')
      expect(parsed!.conditions).toHaveLength(3)
      const group0 = parsed!.conditions.filter((c) => c.group === 0)
      const group1 = parsed!.conditions.filter((c) => c.group === 1)
      expect(group0).toHaveLength(2)
      expect(group1).toHaveLength(1)
    })

    it('round-trips a negated condition', () => {
      const conditions: UnifiedCondition[] = [
        { field: 'user_agent', operator: 'contains', value: 'bot', negated: true },
      ]
      const expression = ExpressionBuilder.fromUnifiedConditions(conditions, 'AND')

      const parsed = parseWirefilterExpression(expression)

      expect(parsed).not.toBeNull()
      // negated: true + contains generates the same wirefilter text as the
      // dedicated not_contains operator — the parser canonicalizes to the
      // more specific enum value, so this is an intentional, documented
      // asymmetry rather than a bug (see leafToCondition's comment).
      expect(parsed!.conditions[0]).toMatchObject({ field: 'user_agent', operator: 'not_contains', value: 'bot' })
    })

    // A keyed header/cookie/query condition no longer round-trips through
    // this parser as of #269 — ExpressionBuilder emits `any(field["key"][*]
    // <op> value)`/`has_key(field, "key")` for these (the type-valid
    // Cloudflare construct; see ExpressionBuilder.buildKeyedMapExpression),
    // and this parser understands only the bracket-index/`exists` grammar it
    // previously produced. This is a deliberate, safe degradation matching
    // the class's own documented contract (falls back to `null` — "unsupported,
    // reported... rather than guessed at" — for anything outside the exact
    // subset ExpressionBuilder currently generates), not a silent
    // misparse — `cloudflareToUnified` already has a warning path for
    // exactly this (see translator.test.ts's "falls back to empty
    // conditions with a warning" test). Extending this parser to understand
    // the new construct is tracked separately, not done here.
    it("no longer round-trips a keyed header condition — any(...)/has_key(...) is outside this parser's grammar", () => {
      const conditions: UnifiedCondition[] = [{ field: 'header', key: 'X-Custom', operator: 'eq', value: 'value' }]
      const expression = ExpressionBuilder.fromUnifiedConditions(conditions, 'AND')

      expect(expression).toBe('any(http.request.headers["x-custom"][*] eq "value")')
      expect(parseWirefilterExpression(expression)).toBeNull()
    })

    it('round-trips an "in" condition with an array value', () => {
      const conditions: UnifiedCondition[] = [{ field: 'method', operator: 'in', value: ['GET', 'HEAD'] }]
      const expression = ExpressionBuilder.fromUnifiedConditions(conditions, 'AND')

      const parsed = parseWirefilterExpression(expression)

      expect(parsed).not.toBeNull()
      expect(parsed!.conditions[0]).toMatchObject({ field: 'method', operator: 'in', value: ['GET', 'HEAD'] })
    })
  })

  describe('fail-closed OR branches (#252)', () => {
    // Shared with CelParser via orGroupsToConditions — a silently-dropped OR
    // branch would change what the rule matches (e.g. `A or B` parsing back
    // as just `A`), so the whole parse must fail rather than return a
    // partial result.
    it('returns null when one OR branch is syntactically valid wirefilter but references an unmapped field', () => {
      // First branch maps fine (http.host -> host); second is a real
      // comparison node the parser can't map to any unified field, so it
      // contributes zero conditions to its group.
      const result = parseWirefilterExpression('http.host eq "test" or nonexistent.field eq "x"')
      expect(result).toBeNull()
    })
  })
})
