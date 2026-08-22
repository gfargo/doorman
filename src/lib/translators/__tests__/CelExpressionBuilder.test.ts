import { CelExpressionBuilder } from '../CelExpressionBuilder'
import type { UnifiedCondition } from '../../types/unified'

describe('CelExpressionBuilder', () => {
  describe('fromUnifiedCondition — simple fields', () => {
    it('builds a path eq comparison', () => {
      const c: UnifiedCondition = { field: 'path', operator: 'eq', value: '/api' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.path == '/api'")
    })

    it('builds a path contains comparison', () => {
      const c: UnifiedCondition = { field: 'path', operator: 'contains', value: 'admin' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.path.contains('admin')")
    })

    it('builds a path starts_with comparison', () => {
      const c: UnifiedCondition = { field: 'path', operator: 'starts_with', value: '/api' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.path.startsWith('/api')")
    })

    it('builds a path ends_with comparison', () => {
      const c: UnifiedCondition = { field: 'path', operator: 'ends_with', value: '.php' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.path.endsWith('.php')")
    })

    it('builds a path matches (regex) comparison', () => {
      const c: UnifiedCondition = { field: 'path', operator: 'matches', value: '/user/[0-9]+' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.path.matches('/user/[0-9]+')")
    })

    it('builds a method eq comparison', () => {
      const c: UnifiedCondition = { field: 'method', operator: 'eq', value: 'POST' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.method == 'POST'")
    })

    it('builds a method in-list comparison', () => {
      const c: UnifiedCondition = { field: 'method', operator: 'in', value: ['GET', 'POST'] }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.method in ['GET', 'POST']")
    })

    it('builds a method not_in-list comparison', () => {
      const c: UnifiedCondition = { field: 'method', operator: 'not_in', value: ['GET', 'POST'] }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("!(request.method in ['GET', 'POST'])")
    })

    it('builds a country eq comparison against origin.region_code', () => {
      const c: UnifiedCondition = { field: 'country', operator: 'eq', value: 'US' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("origin.region_code == 'US'")
    })

    it('builds a numeric asn comparison, unquoted', () => {
      const c: UnifiedCondition = { field: 'asn', operator: 'eq', value: 15169 }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe('origin.asn == 15169')
    })

    it('builds asn gt/ge/lt/le comparisons', () => {
      expect(CelExpressionBuilder.fromUnifiedCondition({ field: 'asn', operator: 'gt', value: 1000 })).toBe(
        'origin.asn > 1000',
      )
      expect(CelExpressionBuilder.fromUnifiedCondition({ field: 'asn', operator: 'ge', value: 1000 })).toBe(
        'origin.asn >= 1000',
      )
      expect(CelExpressionBuilder.fromUnifiedCondition({ field: 'asn', operator: 'lt', value: 1000 })).toBe(
        'origin.asn < 1000',
      )
      expect(CelExpressionBuilder.fromUnifiedCondition({ field: 'asn', operator: 'le', value: 1000 })).toBe(
        'origin.asn <= 1000',
      )
    })

    it('builds a query condition against the raw query string, no guard', () => {
      const c: UnifiedCondition = { field: 'query', operator: 'contains', value: 'debug=true' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.query.contains('debug=true')")
    })

    it('throws when asn is given a non-numeric value', () => {
      expect(() =>
        CelExpressionBuilder.fromUnifiedCondition({ field: 'asn', operator: 'eq', value: 'not-a-number' }),
      ).toThrow(/numeric/i)
    })
  })

  describe('fromUnifiedCondition — header-backed fields (has() guard)', () => {
    it('guards a host comparison with has()', () => {
      const c: UnifiedCondition = { field: 'host', operator: 'eq', value: 'example.com' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(has(request.headers['host']) && request.headers['host'] == 'example.com')",
      )
    })

    it('guards a user_agent contains with has()', () => {
      const c: UnifiedCondition = { field: 'user_agent', operator: 'contains', value: 'bot' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(has(request.headers['user-agent']) && request.headers['user-agent'].contains('bot'))",
      )
    })

    it('guards a referer comparison with has()', () => {
      const c: UnifiedCondition = { field: 'referer', operator: 'eq', value: 'evil.example' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(has(request.headers['referer']) && request.headers['referer'] == 'evil.example')",
      )
    })

    it('builds host exists as a bare has() with no comparison', () => {
      const c: UnifiedCondition = { field: 'host', operator: 'exists', value: '' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("has(request.headers['host'])")
    })

    it('builds host not_exists as a negated has()', () => {
      const c: UnifiedCondition = { field: 'host', operator: 'not_exists', value: '' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("!has(request.headers['host'])")
    })

    it('negates not_contains inside the guard, not around it', () => {
      const c: UnifiedCondition = { field: 'user_agent', operator: 'not_contains', value: 'bot' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(has(request.headers['user-agent']) && !request.headers['user-agent'].contains('bot'))",
      )
    })

    it('builds an arbitrary header condition by key', () => {
      const c: UnifiedCondition = { field: 'header', key: 'x-custom-header', operator: 'eq', value: 'yes' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(has(request.headers['x-custom-header']) && request.headers['x-custom-header'] == 'yes')",
      )
    })

    it('throws for a header condition with no key', () => {
      expect(() =>
        CelExpressionBuilder.fromUnifiedCondition({ field: 'header', operator: 'eq', value: 'yes' }),
      ).toThrow(/requires a key/i)
    })
  })

  describe('fromUnifiedCondition — cookie', () => {
    it('composes a key=value substring check for a keyed eq condition', () => {
      const c: UnifiedCondition = { field: 'cookie', key: 'session', operator: 'eq', value: 'abc123' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(has(request.headers['cookie']) && request.headers['cookie'].contains('session=abc123'))",
      )
    })

    it('negates a keyed not_contains condition inside the guard', () => {
      const c: UnifiedCondition = { field: 'cookie', key: 'session', operator: 'not_contains', value: 'abc123' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(has(request.headers['cookie']) && !request.headers['cookie'].contains('session=abc123'))",
      )
    })

    it('checks the whole cookie header when no key is given', () => {
      const c: UnifiedCondition = { field: 'cookie', operator: 'contains', value: 'admin=true' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(has(request.headers['cookie']) && request.headers['cookie'].contains('admin=true'))",
      )
    })

    it('throws for a keyed cookie condition using an operator with no unambiguous substring meaning', () => {
      expect(() =>
        CelExpressionBuilder.fromUnifiedCondition({
          field: 'cookie',
          key: 'session',
          operator: 'starts_with',
          value: 'abc',
        }),
      ).toThrow(/no unambiguous CEL representation/i)
    })

    it('builds cookie exists/not_exists as a bare guard, same as header', () => {
      expect(CelExpressionBuilder.fromUnifiedCondition({ field: 'cookie', operator: 'exists', value: '' })).toBe(
        "has(request.headers['cookie'])",
      )
      expect(CelExpressionBuilder.fromUnifiedCondition({ field: 'cookie', operator: 'not_exists', value: '' })).toBe(
        "!has(request.headers['cookie'])",
      )
    })
  })

  describe('fromUnifiedCondition — ip', () => {
    it('builds a plain equality check for a bare IP', () => {
      const c: UnifiedCondition = { field: 'ip', operator: 'eq', value: '203.0.113.9' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("origin.ip == '203.0.113.9'")
    })

    it('builds inIpRange() for a CIDR value', () => {
      const c: UnifiedCondition = { field: 'ip', operator: 'eq', value: '198.51.100.0/24' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("inIpRange(origin.ip, '198.51.100.0/24')")
    })

    it('ORs multiple CIDR/IP values together for an "in" condition', () => {
      const c: UnifiedCondition = { field: 'ip', operator: 'in', value: ['198.51.100.0/24', '203.0.113.9'] }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "(inIpRange(origin.ip, '198.51.100.0/24') || origin.ip == '203.0.113.9')",
      )
    })

    it('negates a single inIpRange() check directly (function call — no precedence hazard)', () => {
      const c: UnifiedCondition = { field: 'ip', operator: 'ne', value: '198.51.100.0/24' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("!inIpRange(origin.ip, '198.51.100.0/24')")
    })

    it('parenthesizes a negated single bare-IP equality (precedence-safe — regression guard)', () => {
      const c: UnifiedCondition = { field: 'ip', operator: 'ne', value: '203.0.113.9' }
      const result = CelExpressionBuilder.fromUnifiedCondition(c)
      expect(result).toBe("!(origin.ip == '203.0.113.9')")
      // The un-parenthesized form `!origin.ip == 'x'` would parse in CEL as
      // `(!origin.ip) == 'x'` — a type error against a string. This is the
      // bug this test guards against.
      expect(result).not.toBe("!origin.ip == '203.0.113.9'")
    })

    it('negates a multi-value "not_in" as a wrapped OR group', () => {
      const c: UnifiedCondition = { field: 'ip', operator: 'not_in', value: ['198.51.100.0/24', '203.0.113.9'] }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe(
        "!(inIpRange(origin.ip, '198.51.100.0/24') || origin.ip == '203.0.113.9')",
      )
    })

    it('throws for an invalid IP/CIDR value', () => {
      expect(() =>
        CelExpressionBuilder.fromUnifiedCondition({ field: 'ip', operator: 'eq', value: 'not-an-ip' }),
      ).toThrow(/Invalid IP/i)
    })
  })

  describe('fromUnifiedCondition — unsupported fields', () => {
    it.each(['region', 'city', 'port', 'scheme'])(
      'throws a clear error for "%s" (no Cloud Armor CEL equivalent)',
      (field) => {
        expect(() => CelExpressionBuilder.fromUnifiedCondition({ field, operator: 'eq', value: 'x' })).toThrow(
          /no CEL equivalent/i,
        )
      },
    )
  })

  describe('fromUnifiedConditions — grouping', () => {
    it('joins a flat set of conditions with &&', () => {
      const conditions: UnifiedCondition[] = [
        { field: 'path', operator: 'eq', value: '/api' },
        { field: 'method', operator: 'eq', value: 'POST' },
      ]
      expect(CelExpressionBuilder.fromUnifiedConditions(conditions, 'AND')).toBe(
        "(request.path == '/api' && request.method == 'POST')",
      )
    })

    it('joins a flat set of conditions with ||', () => {
      const conditions: UnifiedCondition[] = [
        { field: 'path', operator: 'eq', value: '/api' },
        { field: 'path', operator: 'eq', value: '/admin' },
      ]
      expect(CelExpressionBuilder.fromUnifiedConditions(conditions, 'OR')).toBe(
        "(request.path == '/api' || request.path == '/admin')",
      )
    })

    it('builds AND-within-group, OR-across-groups from a grouped condition set', () => {
      const conditions: UnifiedCondition[] = [
        { field: 'path', operator: 'eq', value: '/a', group: 0 },
        { field: 'method', operator: 'eq', value: 'POST', group: 0 },
        { field: 'path', operator: 'eq', value: '/b', group: 1 },
      ]
      expect(CelExpressionBuilder.fromUnifiedConditions(conditions)).toBe(
        "((request.path == '/a' && request.method == 'POST') || request.path == '/b')",
      )
    })

    it('throws for an empty condition list', () => {
      expect(() => CelExpressionBuilder.fromUnifiedConditions([])).toThrow(/at least one condition/i)
    })
  })

  describe('escaping', () => {
    it('escapes a single quote in a string value', () => {
      const c: UnifiedCondition = { field: 'path', operator: 'eq', value: "/it's" }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.path == '/it\\'s'")
    })

    it('escapes a backslash before quote-escaping (regression guard for the same class of bug wirefilterEscape documents)', () => {
      const c: UnifiedCondition = { field: 'path', operator: 'eq', value: '/a\\' }
      expect(CelExpressionBuilder.fromUnifiedCondition(c)).toBe("request.path == '/a\\\\'")
    })
  })
})
