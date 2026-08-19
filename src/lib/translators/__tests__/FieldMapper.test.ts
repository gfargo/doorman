jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { FieldMapper } from '../FieldMapper'

describe('FieldMapper', () => {
  describe('toCloudflare', () => {
    it('maps host to http.host', () => {
      expect(FieldMapper.toCloudflare('host')).toBe('http.host')
    })

    it('maps path to http.request.uri.path', () => {
      expect(FieldMapper.toCloudflare('path')).toBe('http.request.uri.path')
    })

    it('maps method to http.request.method', () => {
      expect(FieldMapper.toCloudflare('method')).toBe('http.request.method')
    })

    it('maps query to http.request.uri.query', () => {
      expect(FieldMapper.toCloudflare('query')).toBe('http.request.uri.query')
    })

    it('maps cookie to http.cookie', () => {
      expect(FieldMapper.toCloudflare('cookie')).toBe('http.cookie')
    })

    it('maps target_path to http.request.uri.path', () => {
      expect(FieldMapper.toCloudflare('target_path')).toBe('http.request.uri.path')
    })

    it('maps ip_address to ip.src', () => {
      expect(FieldMapper.toCloudflare('ip_address')).toBe('ip.src')
    })

    it('maps region to ip.geoip.subdivision_1', () => {
      expect(FieldMapper.toCloudflare('region')).toBe('ip.geoip.subdivision_1')
    })

    it('maps protocol to ssl', () => {
      expect(FieldMapper.toCloudflare('protocol')).toBe('ssl')
    })

    it('maps scheme to ssl', () => {
      expect(FieldMapper.toCloudflare('scheme')).toBe('ssl')
    })

    it('maps user_agent to http.user_agent', () => {
      expect(FieldMapper.toCloudflare('user_agent')).toBe('http.user_agent')
    })

    it('maps geo_continent to ip.geoip.continent', () => {
      expect(FieldMapper.toCloudflare('geo_continent')).toBe('ip.geoip.continent')
    })

    it('maps geo_country to ip.geoip.country', () => {
      expect(FieldMapper.toCloudflare('geo_country')).toBe('ip.geoip.country')
    })

    it('maps geo_country_region to ip.geoip.subdivision_1', () => {
      expect(FieldMapper.toCloudflare('geo_country_region')).toBe('ip.geoip.subdivision_1')
    })

    it('maps geo_city to ip.geoip.city', () => {
      expect(FieldMapper.toCloudflare('geo_city')).toBe('ip.geoip.city')
    })

    it('maps geo_as_number to ip.geoip.asnum', () => {
      expect(FieldMapper.toCloudflare('geo_as_number')).toBe('ip.geoip.asnum')
    })

    it('maps header with key to indexed header field', () => {
      expect(FieldMapper.toCloudflare('header', 'X-Custom')).toBe('http.request.headers["x-custom"]')
    })

    it('maps cookie with key to indexed cookie field', () => {
      expect(FieldMapper.toCloudflare('cookie', 'session_id')).toBe('http.cookie["session_id"]')
    })

    it('escapes quotes in a header key so it cannot break out of the field reference', () => {
      const result = FieldMapper.toCloudflare('header', 'x"] or (true) or http.request.headers["x')
      expect(result).toBe('http.request.headers["x\\"] or (true) or http.request.headers[\\"x"]')
      expect(result).not.toMatch(/headers\["[^"\\]*"\] or/)
    })

    it('escapes quotes in a cookie key so it cannot break out of the field reference', () => {
      const result = FieldMapper.toCloudflare('cookie', 'a" or true or http.cookie["a')
      expect(result).toBe('http.cookie["a\\" or true or http.cookie[\\"a"]')
    })

    it('throws for environment (Vercel-specific, no mapping)', () => {
      expect(() => FieldMapper.toCloudflare('environment')).toThrow(/Unsupported Vercel rule type/)
    })

    it('throws for ja4_digest (Vercel-specific, no mapping)', () => {
      expect(() => FieldMapper.toCloudflare('ja4_digest')).toThrow(/Unsupported Vercel rule type/)
    })

    it('throws for ja3_digest (Vercel-specific, no mapping)', () => {
      expect(() => FieldMapper.toCloudflare('ja3_digest')).toThrow(/Unsupported Vercel rule type/)
    })

    it('throws for rate_limit_api_id (Vercel-specific, no mapping)', () => {
      expect(() => FieldMapper.toCloudflare('rate_limit_api_id')).toThrow(/Unsupported Vercel rule type/)
    })
  })

  describe('toVercel', () => {
    it('maps http.host to host', () => {
      expect(FieldMapper.toVercel('http.host')).toEqual({ type: 'host' })
    })

    it('maps http.request.uri.path to path', () => {
      expect(FieldMapper.toVercel('http.request.uri.path')).toEqual({ type: 'path' })
    })

    it('maps http.request.method to method', () => {
      expect(FieldMapper.toVercel('http.request.method')).toEqual({ type: 'method' })
    })

    it('maps http.request.headers to header', () => {
      expect(FieldMapper.toVercel('http.request.headers')).toEqual({ type: 'header' })
    })

    it('maps http.request.uri.query to query', () => {
      expect(FieldMapper.toVercel('http.request.uri.query')).toEqual({ type: 'query' })
    })

    it('maps http.cookie to cookie', () => {
      expect(FieldMapper.toVercel('http.cookie')).toEqual({ type: 'cookie' })
    })

    it('maps ip.src to ip_address', () => {
      expect(FieldMapper.toVercel('ip.src')).toEqual({ type: 'ip_address' })
    })

    it('maps ip.geoip.subdivision_1 to region', () => {
      expect(FieldMapper.toVercel('ip.geoip.subdivision_1')).toEqual({ type: 'region' })
    })

    it('maps ssl to protocol', () => {
      expect(FieldMapper.toVercel('ssl')).toEqual({ type: 'protocol' })
    })

    it('maps http.user_agent to user_agent', () => {
      expect(FieldMapper.toVercel('http.user_agent')).toEqual({ type: 'user_agent' })
    })

    // Regression test: Vercel has no dedicated referer condition type — it's
    // a header condition keyed on 'referer'. The key was previously dropped
    // (the field mapped to a bare `{ type: 'header' }` with no key), which
    // would translate into a header condition matching *any* header rather
    // than specifically Referer.
    it('maps http.referer to a header condition keyed on referer', () => {
      expect(FieldMapper.toVercel('http.referer')).toEqual({ type: 'header', key: 'referer' })
    })

    it('maps ip.geoip.continent to geo_continent', () => {
      expect(FieldMapper.toVercel('ip.geoip.continent')).toEqual({ type: 'geo_continent' })
    })

    it('maps ip.geoip.country to geo_country', () => {
      expect(FieldMapper.toVercel('ip.geoip.country')).toEqual({ type: 'geo_country' })
    })

    it('maps ip.geoip.city to geo_city', () => {
      expect(FieldMapper.toVercel('ip.geoip.city')).toEqual({ type: 'geo_city' })
    })

    it('maps ip.geoip.asnum to geo_as_number', () => {
      expect(FieldMapper.toVercel('ip.geoip.asnum')).toEqual({ type: 'geo_as_number' })
    })

    it('extracts key from indexed header field', () => {
      expect(FieldMapper.toVercel('http.request.headers["x-forwarded-for"]')).toEqual({
        type: 'header',
        key: 'x-forwarded-for',
      })
    })

    it('extracts key from indexed cookie field', () => {
      expect(FieldMapper.toVercel('http.cookie["session"]')).toEqual({
        type: 'cookie',
        key: 'session',
      })
    })

    it('throws for unsupported Cloudflare field', () => {
      expect(() => FieldMapper.toVercel('cf.bot_management.score')).toThrow(/Unsupported Cloudflare field for Vercel/)
    })
  })

  describe('isCloudflareSupported', () => {
    it('returns true for supported types', () => {
      expect(FieldMapper.isCloudflareSupported('path')).toBe(true)
      expect(FieldMapper.isCloudflareSupported('ip_address')).toBe(true)
      expect(FieldMapper.isCloudflareSupported('geo_country')).toBe(true)
    })

    it('returns false for unsupported types', () => {
      expect(FieldMapper.isCloudflareSupported('environment')).toBe(false)
      expect(FieldMapper.isCloudflareSupported('ja4_digest')).toBe(false)
      expect(FieldMapper.isCloudflareSupported('ja3_digest')).toBe(false)
      expect(FieldMapper.isCloudflareSupported('rate_limit_api_id')).toBe(false)
    })
  })

  describe('isVercelSupported', () => {
    it('returns true for directly mapped fields', () => {
      expect(FieldMapper.isVercelSupported('http.host')).toBe(true)
      expect(FieldMapper.isVercelSupported('ip.src')).toBe(true)
    })

    it('returns true for indexed header fields', () => {
      expect(FieldMapper.isVercelSupported('http.request.headers["x-custom"]')).toBe(true)
    })

    it('returns true for indexed cookie fields', () => {
      expect(FieldMapper.isVercelSupported('http.cookie["session"]')).toBe(true)
    })

    it('returns false for unsupported fields', () => {
      expect(FieldMapper.isVercelSupported('cf.bot_management.score')).toBe(false)
      expect(FieldMapper.isVercelSupported('cf.threat_score')).toBe(false)
    })
  })

  describe('getSupportedCloudflareFields', () => {
    it('returns an array of non-empty Cloudflare fields', () => {
      const fields = FieldMapper.getSupportedCloudflareFields()
      expect(Array.isArray(fields)).toBe(true)
      expect(fields.length).toBeGreaterThan(0)
      expect(fields).toContain('http.host')
      expect(fields).toContain('ip.src')
      expect(fields).not.toContain('')
    })
  })

  describe('getSupportedVercelTypes', () => {
    it('returns an array of Vercel types that have Cloudflare mappings', () => {
      const types = FieldMapper.getSupportedVercelTypes()
      expect(Array.isArray(types)).toBe(true)
      expect(types.length).toBeGreaterThan(0)
      expect(types).toContain('path')
      expect(types).toContain('ip_address')
      expect(types).not.toContain('environment')
      expect(types).not.toContain('ja4_digest')
    })
  })
})
