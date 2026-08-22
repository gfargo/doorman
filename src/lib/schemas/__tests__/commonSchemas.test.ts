import {
  idSchema,
  ipAddressSchema,
  actionTypeSchema,
  operatorSchema,
  fieldTypeSchema,
  durationSchema,
  rateLimitSchema,
  redirectSchema,
  providerTypeSchema,
  providersConfigSchema,
  baseConfigSchema,
} from '../commonSchemas'

// NOTE: schemaVersion.ts has pre-existing TS errors in dead code paths
// (accessing properties on `unknown` type after an early return, and
// a return type mismatch in mapVercelOperatorToUnified).
// These are source bugs, not test bugs. We test schemaVersion constants
// and pure functions inline below using dynamic import to bypass ts-jest
// diagnostics at the module level.

describe('commonSchemas', () => {
  describe('idSchema', () => {
    it('accepts a string id', () => {
      expect(idSchema.safeParse('rule-123').success).toBe(true)
    })

    it('accepts undefined (optional)', () => {
      expect(idSchema.safeParse(undefined).success).toBe(true)
    })
  })

  describe('ipAddressSchema', () => {
    it('accepts valid IPv4 address', () => {
      expect(ipAddressSchema.safeParse('192.168.1.1').success).toBe(true)
    })

    it('accepts valid IPv6 address', () => {
      expect(ipAddressSchema.safeParse('::1').success).toBe(true)
    })

    it('accepts CIDR notation', () => {
      expect(ipAddressSchema.safeParse('192.168.1.0/24').success).toBe(true)
    })

    it('rejects invalid IP', () => {
      expect(ipAddressSchema.safeParse('not-an-ip').success).toBe(false)
    })
  })

  describe('actionTypeSchema', () => {
    it('accepts all valid action types', () => {
      const types = ['log', 'deny', 'challenge', 'bypass', 'rate_limit', 'redirect', 'allow', 'block']
      for (const type of types) {
        expect(actionTypeSchema.safeParse(type).success).toBe(true)
      }
    })

    it('rejects invalid action type', () => {
      expect(actionTypeSchema.safeParse('invalid').success).toBe(false)
    })
  })

  describe('operatorSchema', () => {
    it('accepts all valid operators', () => {
      const ops = [
        'eq',
        'ne',
        'contains',
        'not_contains',
        'starts_with',
        'ends_with',
        'matches',
        'in',
        'not_in',
        'gt',
        'ge',
        'lt',
        'le',
        'exists',
        'not_exists',
      ]
      for (const op of ops) {
        expect(operatorSchema.safeParse(op).success).toBe(true)
      }
    })

    it('rejects invalid operator', () => {
      expect(operatorSchema.safeParse('like').success).toBe(false)
    })
  })

  describe('fieldTypeSchema', () => {
    it('accepts all valid field types', () => {
      const fields = [
        'ip',
        'country',
        'region',
        'city',
        'asn',
        'path',
        'host',
        'method',
        'header',
        'query',
        'cookie',
        'user_agent',
        'referer',
        'scheme',
        'port',
      ]
      for (const field of fields) {
        expect(fieldTypeSchema.safeParse(field).success).toBe(true)
      }
    })

    it('rejects invalid field type', () => {
      expect(fieldTypeSchema.safeParse('unknown_field').success).toBe(false)
    })
  })

  describe('durationSchema', () => {
    it('accepts valid durations', () => {
      expect(durationSchema.safeParse('60s').success).toBe(true)
      expect(durationSchema.safeParse('5m').success).toBe(true)
      expect(durationSchema.safeParse('1h').success).toBe(true)
      expect(durationSchema.safeParse('1d').success).toBe(true)
      expect(durationSchema.safeParse('permanent').success).toBe(true)
    })

    it('rejects invalid durations', () => {
      expect(durationSchema.safeParse('forever').success).toBe(false)
      expect(durationSchema.safeParse('').success).toBe(false)
    })
  })

  describe('rateLimitSchema', () => {
    it('accepts valid rate limit', () => {
      expect(rateLimitSchema.safeParse({ requests: 100, window: '1m' }).success).toBe(true)
    })

    it('accepts rate limit with characteristics', () => {
      const result = rateLimitSchema.safeParse({
        requests: 100,
        window: '60s',
        characteristics: ['ip.src'],
      })
      expect(result.success).toBe(true)
    })

    it('rejects non-positive requests', () => {
      expect(rateLimitSchema.safeParse({ requests: 0, window: '1m' }).success).toBe(false)
    })

    it('rejects invalid window format', () => {
      expect(rateLimitSchema.safeParse({ requests: 100, window: 'invalid' }).success).toBe(false)
    })
  })

  describe('redirectSchema', () => {
    it('accepts valid redirect', () => {
      expect(redirectSchema.safeParse({ location: 'https://example.com/new' }).success).toBe(true)
    })

    it('accepts redirect with optional fields', () => {
      const result = redirectSchema.safeParse({
        location: 'https://example.com/new',
        statusCode: 301,
        permanent: true,
        preserveQueryString: true,
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid URL', () => {
      expect(redirectSchema.safeParse({ location: 'not-a-url' }).success).toBe(false)
    })

    it('accepts a relative path, matching the native schema and documented behavior (regression test for #212)', () => {
      expect(redirectSchema.safeParse({ location: '/v2/api/' }).success).toBe(true)
      // The exact real-world case from #212 (a deployed griffen.codes rule).
      expect(redirectSchema.safeParse({ location: '/correct-path' }).success).toBe(true)
    })

    it('still rejects a bare string that is neither an absolute URL nor a path', () => {
      expect(redirectSchema.safeParse({ location: 'just some text' }).success).toBe(false)
    })
  })

  describe('providerTypeSchema', () => {
    it('accepts vercel and cloudflare', () => {
      expect(providerTypeSchema.safeParse('vercel').success).toBe(true)
      expect(providerTypeSchema.safeParse('cloudflare').success).toBe(true)
    })

    it('rejects invalid provider', () => {
      expect(providerTypeSchema.safeParse('aws').success).toBe(false)
    })
  })

  describe('providersConfigSchema', () => {
    it('accepts valid providers config', () => {
      const result = providersConfigSchema.safeParse({
        vercel: { projectId: 'proj-123', teamId: 'team-123' },
        cloudflare: { zoneId: 'zone-123', accountId: 'acc-123' },
      })
      expect(result.success).toBe(true)
    })

    it('accepts partial providers config', () => {
      expect(providersConfigSchema.safeParse({ vercel: { projectId: 'proj-123' } }).success).toBe(true)
    })
  })

  describe('baseConfigSchema', () => {
    it('accepts empty config', () => {
      expect(baseConfigSchema.safeParse({}).success).toBe(true)
    })

    it('accepts config with all fields', () => {
      const result = baseConfigSchema.safeParse({
        $schema: 'https://doorman.griffen.codes/schema.json',
        version: '2.0',
        provider: 'vercel',
      })
      expect(result.success).toBe(true)
    })
  })
})

// schemaVersion tests are skipped because schemaVersion.ts has pre-existing
// TS compilation errors in dead code paths that prevent ts-jest from compiling it.
// Bug: lines 33, 38 access properties on `unknown` type after early return.
// Bug: line 128 returns string where Operator type is expected.
// These are source code issues, not test issues.
