jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { ExpressionBuilder } from '../ExpressionBuilder'
import type { VercelRuleCondition, VercelConditionGroup } from '../../types/vercel'
import type { UnifiedCondition } from '../../types/unified'

describe('ExpressionBuilder', () => {
  describe('fromVercelConditionGroups', () => {
    it('builds expression from a single condition group with one condition', () => {
      const groups: VercelConditionGroup[] = [
        {
          conditions: [{ type: 'path', op: 'eq', value: '/api' }],
        },
      ]
      expect(ExpressionBuilder.fromVercelConditionGroups(groups)).toBe('http.request.uri.path eq "/api"')
    })

    it('builds AND expression from a single group with multiple conditions', () => {
      const groups: VercelConditionGroup[] = [
        {
          conditions: [
            { type: 'path', op: 'eq', value: '/api' },
            { type: 'method', op: 'eq', value: 'POST' },
          ],
        },
      ]
      const result = ExpressionBuilder.fromVercelConditionGroups(groups)
      expect(result).toBe('(http.request.uri.path eq "/api" and http.request.method eq "POST")')
    })

    it('builds OR expression from multiple condition groups', () => {
      const groups: VercelConditionGroup[] = [
        { conditions: [{ type: 'path', op: 'eq', value: '/api' }] },
        { conditions: [{ type: 'path', op: 'eq', value: '/admin' }] },
      ]
      const result = ExpressionBuilder.fromVercelConditionGroups(groups)
      expect(result).toBe('http.request.uri.path eq "/api" or http.request.uri.path eq "/admin"')
    })

    it('builds complex expression with AND within groups and OR between groups', () => {
      const groups: VercelConditionGroup[] = [
        {
          conditions: [
            { type: 'path', op: 'pre', value: '/api' },
            { type: 'method', op: 'eq', value: 'POST' },
          ],
        },
        {
          conditions: [{ type: 'path', op: 'eq', value: '/admin' }],
        },
      ]
      const result = ExpressionBuilder.fromVercelConditionGroups(groups)
      expect(result).toBe(
        '(http.request.uri.path starts_with "/api" and http.request.method eq "POST") or http.request.uri.path eq "/admin"',
      )
    })

    it('throws when condition groups array is empty', () => {
      expect(() => ExpressionBuilder.fromVercelConditionGroups([])).toThrow('At least one condition group is required')
    })

    it('throws when a condition group has no conditions', () => {
      const groups: VercelConditionGroup[] = [{ conditions: [] }]
      expect(() => ExpressionBuilder.fromVercelConditionGroups(groups)).toThrow(
        'Condition group must have at least one condition',
      )
    })
  })

  describe('fromVercelCondition', () => {
    it('builds eq expression', () => {
      const condition: VercelRuleCondition = { type: 'path', op: 'eq', value: '/test' }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('http.request.uri.path eq "/test"')
    })

    it('builds starts_with (pre) expression', () => {
      const condition: VercelRuleCondition = { type: 'path', op: 'pre', value: '/api/' }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('http.request.uri.path starts_with "/api/"')
    })

    it('builds ends_with (suf) expression', () => {
      const condition: VercelRuleCondition = { type: 'path', op: 'suf', value: '.php' }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('http.request.uri.path ends_with ".php"')
    })

    it('builds contains (sub) expression', () => {
      const condition: VercelRuleCondition = { type: 'user_agent', op: 'sub', value: 'BadBot' }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('http.user_agent contains "BadBot"')
    })

    it('builds in (inc) expression with array value', () => {
      const condition: VercelRuleCondition = { type: 'geo_country', op: 'inc', value: ['US', 'CA', 'GB'] }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('ip.geoip.country in {"US" "CA" "GB"}')
    })

    it('builds matches (re) expression', () => {
      const condition: VercelRuleCondition = { type: 'path', op: 're', value: '^/api/v[0-9]+' }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('http.request.uri.path matches "^/api/v[0-9]+"')
    })

    it('handles negated conditions', () => {
      const condition: VercelRuleCondition = { type: 'path', op: 'eq', value: '/public', neg: true }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('not (http.request.uri.path eq "/public")')
    })

    it('handles ip_address field', () => {
      const condition: VercelRuleCondition = { type: 'ip_address', op: 'eq', value: '192.168.1.1' }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('ip.src eq "192.168.1.1"')
    })

    it('handles header with key', () => {
      const condition: VercelRuleCondition = {
        type: 'header',
        op: 'eq',
        value: 'application/json',
        key: 'Content-Type',
      }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe(
        'http.request.headers["content-type"] eq "application/json"',
      )
    })

    it('escapes quotes in a header key so it cannot break out of the field reference', () => {
      const condition: VercelRuleCondition = {
        type: 'header',
        op: 'eq',
        value: 'x',
        key: 'x"] or (true) or http.request.headers["x',
      }
      const result = ExpressionBuilder.fromVercelCondition(condition)
      // The escaped key must stay inside a single string literal — no unescaped
      // `"]` sequence should appear anywhere in the generated field reference.
      expect(result).toBe('http.request.headers["x\\"] or (true) or http.request.headers[\\"x"] eq "x"')
      expect(result).not.toMatch(/headers\["[^"\\]*"\] or/)
    })

    it('escapes quotes in a cookie key so it cannot break out of the field reference', () => {
      const condition: VercelRuleCondition = {
        type: 'cookie',
        op: 'eq',
        value: 'x',
        key: 'a" or true or http.cookie["a',
      }
      const result = ExpressionBuilder.fromVercelCondition(condition)
      expect(result).toBe('http.cookie["a\\" or true or http.cookie[\\"a"] eq "x"')
    })

    it('handles numeric values', () => {
      const condition: VercelRuleCondition = { type: 'geo_as_number', op: 'eq', value: 13335 }
      expect(ExpressionBuilder.fromVercelCondition(condition)).toBe('ip.geoip.asnum eq 13335')
    })
  })

  describe('fromUnifiedConditions', () => {
    it('builds expression from a single unified condition', () => {
      const conditions: UnifiedCondition[] = [{ field: 'path', operator: 'eq', value: '/test' }]
      expect(ExpressionBuilder.fromUnifiedConditions(conditions)).toBe('http.request.uri.path eq "/test"')
    })

    it('builds AND expression from multiple conditions (default logic)', () => {
      const conditions: UnifiedCondition[] = [
        { field: 'path', operator: 'eq', value: '/api' },
        { field: 'method', operator: 'eq', value: 'POST' },
      ]
      const result = ExpressionBuilder.fromUnifiedConditions(conditions)
      expect(result).toBe('(http.request.uri.path eq "/api" and http.request.method eq "POST")')
    })

    it('builds OR expression when logic is OR', () => {
      const conditions: UnifiedCondition[] = [
        { field: 'path', operator: 'eq', value: '/api' },
        { field: 'path', operator: 'eq', value: '/admin' },
      ]
      const result = ExpressionBuilder.fromUnifiedConditions(conditions, 'OR')
      expect(result).toBe('(http.request.uri.path eq "/api" or http.request.uri.path eq "/admin")')
    })

    it('throws when conditions array is empty', () => {
      expect(() => ExpressionBuilder.fromUnifiedConditions([])).toThrow('At least one condition is required')
    })
  })

  describe('fromUnifiedCondition', () => {
    it('maps unified field types to Cloudflare fields', () => {
      expect(ExpressionBuilder.fromUnifiedCondition({ field: 'ip', operator: 'eq', value: '1.2.3.4' })).toBe(
        'ip.src eq "1.2.3.4"',
      )

      expect(ExpressionBuilder.fromUnifiedCondition({ field: 'country', operator: 'eq', value: 'US' })).toBe(
        'ip.geoip.country eq "US"',
      )

      expect(ExpressionBuilder.fromUnifiedCondition({ field: 'host', operator: 'eq', value: 'example.com' })).toBe(
        'http.host eq "example.com"',
      )
    })

    it('maps unified operators to Cloudflare operators', () => {
      expect(ExpressionBuilder.fromUnifiedCondition({ field: 'path', operator: 'contains', value: 'api' })).toBe(
        'http.request.uri.path contains "api"',
      )

      expect(ExpressionBuilder.fromUnifiedCondition({ field: 'path', operator: 'starts_with', value: '/api' })).toBe(
        'http.request.uri.path starts_with "/api"',
      )

      expect(ExpressionBuilder.fromUnifiedCondition({ field: 'path', operator: 'ends_with', value: '.php' })).toBe(
        'http.request.uri.path ends_with ".php"',
      )

      expect(ExpressionBuilder.fromUnifiedCondition({ field: 'path', operator: 'matches', value: '^/api' })).toBe(
        'http.request.uri.path matches "^/api"',
      )
    })

    it('handles in operator with array values', () => {
      const result = ExpressionBuilder.fromUnifiedCondition({
        field: 'country',
        operator: 'in',
        value: ['US', 'CA'],
      })
      expect(result).toBe('ip.geoip.country in {"US" "CA"}')
    })

    it('handles negated conditions', () => {
      const result = ExpressionBuilder.fromUnifiedCondition({
        field: 'path',
        operator: 'eq',
        value: '/public',
        negated: true,
      })
      expect(result).toBe('not (http.request.uri.path eq "/public")')
    })

    it('handles header conditions with key', () => {
      const result = ExpressionBuilder.fromUnifiedCondition({
        field: 'header',
        operator: 'eq',
        value: 'Bearer token',
        key: 'Authorization',
      })
      expect(result).toBe('http.request.headers["Authorization"] eq "Bearer token"')
    })

    it('escapes quotes in a unified header key so it cannot break out of the field reference', () => {
      const result = ExpressionBuilder.fromUnifiedCondition({
        field: 'header',
        operator: 'eq',
        value: 'x',
        key: 'x"] or (true) or http.request.headers["x',
      })
      expect(result).toBe('http.request.headers["x\\"] or (true) or http.request.headers[\\"x"] eq "x"')
      expect(result).not.toMatch(/headers\["[^"\\]*"\] or/)
    })

    it('escapes backslashes in string values so a trailing backslash cannot consume the closing quote', () => {
      const result = ExpressionBuilder.fromUnifiedCondition({
        field: 'path',
        operator: 'eq',
        value: 'a\\',
      })
      expect(result).toBe('http.request.uri.path eq "a\\\\"')
    })
  })

  describe('validate', () => {
    it('returns true for valid expressions', () => {
      expect(ExpressionBuilder.validate('http.request.uri.path eq "/api"')).toBe(true)
      expect(ExpressionBuilder.validate('(ip.src eq "1.2.3.4" and http.host eq "example.com")')).toBe(true)
    })

    it('returns false for empty expressions', () => {
      expect(ExpressionBuilder.validate('')).toBe(false)
      expect(ExpressionBuilder.validate('   ')).toBe(false)
    })

    it('returns false for unbalanced parentheses', () => {
      expect(ExpressionBuilder.validate('(ip.src eq "1.2.3.4"')).toBe(false)
      expect(ExpressionBuilder.validate('ip.src eq "1.2.3.4")')).toBe(false)
      expect(ExpressionBuilder.validate('((ip.src eq "1.2.3.4")')).toBe(false)
    })

    it('returns true for nested balanced parentheses', () => {
      expect(ExpressionBuilder.validate('((ip.src eq "1.2.3.4"))')).toBe(true)
    })
  })

  describe('combineWithAnd', () => {
    it('returns single expression unchanged', () => {
      expect(ExpressionBuilder.combineWithAnd(['ip.src eq "1.2.3.4"'])).toBe('ip.src eq "1.2.3.4"')
    })

    it('combines multiple expressions with AND', () => {
      const result = ExpressionBuilder.combineWithAnd(['ip.src eq "1.2.3.4"', 'http.host eq "example.com"'])
      expect(result).toBe('(ip.src eq "1.2.3.4" and http.host eq "example.com")')
    })

    it('throws for empty array', () => {
      expect(() => ExpressionBuilder.combineWithAnd([])).toThrow('At least one expression is required')
    })
  })

  describe('combineWithOr', () => {
    it('returns single expression unchanged', () => {
      expect(ExpressionBuilder.combineWithOr(['ip.src eq "1.2.3.4"'])).toBe('ip.src eq "1.2.3.4"')
    })

    it('combines multiple expressions with OR', () => {
      const result = ExpressionBuilder.combineWithOr(['ip.src eq "1.2.3.4"', 'ip.src eq "5.6.7.8"'])
      expect(result).toBe('(ip.src eq "1.2.3.4" or ip.src eq "5.6.7.8")')
    })

    it('throws for empty array', () => {
      expect(() => ExpressionBuilder.combineWithOr([])).toThrow('At least one expression is required')
    })
  })
})
