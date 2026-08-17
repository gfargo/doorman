import type { VercelRuleType } from '../types/vercel'
import type { CloudflareFieldType } from '../types/cloudflare'
import { logger } from '../logger'
import { escapeWirefilterString } from './wirefilterEscape'

/**
 * Maps field types between Vercel and Cloudflare
 */
export class FieldMapper {
  /**
   * Vercel type → Cloudflare field mapping
   */
  private static readonly vercelToCloudflare: Record<VercelRuleType, CloudflareFieldType | string> = {
    host: 'http.host',
    path: 'http.request.uri.path',
    method: 'http.request.method',
    header: 'http.request.headers',
    query: 'http.request.uri.query',
    cookie: 'http.cookie',
    target_path: 'http.request.uri.path',
    ip_address: 'ip.src',
    region: 'ip.geoip.subdivision_1',
    protocol: 'ssl',
    scheme: 'ssl',
    environment: '', // Vercel-specific, no direct mapping
    user_agent: 'http.user_agent',
    geo_continent: 'ip.geoip.continent',
    geo_country: 'ip.geoip.country',
    geo_country_region: 'ip.geoip.subdivision_1',
    geo_city: 'ip.geoip.city',
    geo_as_number: 'ip.geoip.asnum',
    ja4_digest: '', // Vercel-specific
    ja3_digest: '', // Vercel-specific
    rate_limit_api_id: '', // Vercel-specific
  }

  /**
   * Cloudflare field → Vercel type mapping (reverse)
   */
  private static readonly cloudflareToVercel: Record<string, VercelRuleType> = {
    'http.host': 'host',
    'http.request.uri.path': 'path',
    'http.request.method': 'method',
    'http.request.headers': 'header',
    'http.request.uri.query': 'query',
    'http.cookie': 'cookie',
    'ip.src': 'ip_address',
    'ip.geoip.subdivision_1': 'region',
    ssl: 'protocol',
    'http.user_agent': 'user_agent',
    'http.referer': 'header', // Map to header with key 'referer'
    'ip.geoip.continent': 'geo_continent',
    'ip.geoip.country': 'geo_country',
    'ip.geoip.city': 'geo_city',
    'ip.geoip.asnum': 'geo_as_number',
  }

  /**
   * Map Vercel rule type to Cloudflare field
   */
  public static toCloudflare(vercelType: VercelRuleType, key?: string): string {
    const field = this.vercelToCloudflare[vercelType]

    if (!field) {
      logger.warn(`No Cloudflare mapping for Vercel type: ${vercelType}`)
      throw new Error(`Unsupported Vercel rule type for Cloudflare: ${vercelType}`)
    }

    // For header and cookie, append the key
    if (vercelType === 'header' && key) {
      return `${field}["${escapeWirefilterString(key.toLowerCase())}"]`
    }

    if (vercelType === 'cookie' && key) {
      return `${field}["${escapeWirefilterString(key)}"]`
    }

    return field
  }

  /**
   * Map Cloudflare field to Vercel rule type
   */
  public static toVercel(cloudflareField: string): { type: VercelRuleType; key?: string } {
    // Handle header/cookie with keys
    const headerMatch = cloudflareField.match(/http\.request\.headers\["([^"]+)"\]/)
    if (headerMatch) {
      return { type: 'header', key: headerMatch[1] }
    }

    const cookieMatch = cloudflareField.match(/http\.cookie\["([^"]+)"\]/)
    if (cookieMatch) {
      return { type: 'cookie', key: cookieMatch[1] }
    }

    // Direct mapping
    const vercelType = this.cloudflareToVercel[cloudflareField]
    if (vercelType) {
      return { type: vercelType }
    }

    logger.warn(`No Vercel mapping for Cloudflare field: ${cloudflareField}`)
    throw new Error(`Unsupported Cloudflare field for Vercel: ${cloudflareField}`)
  }

  /**
   * Check if a Vercel rule type is supported in Cloudflare
   */
  public static isCloudflareSupported(vercelType: VercelRuleType): boolean {
    const field = this.vercelToCloudflare[vercelType]
    return !!field && field !== ''
  }

  /**
   * Check if a Cloudflare field is supported in Vercel
   */
  public static isVercelSupported(cloudflareField: string): boolean {
    // Check direct mapping
    if (this.cloudflareToVercel[cloudflareField]) {
      return true
    }

    // Check header/cookie patterns
    if (cloudflareField.startsWith('http.request.headers[') || cloudflareField.startsWith('http.cookie[')) {
      return true
    }

    return false
  }

  /**
   * Get all supported Cloudflare fields
   */
  public static getSupportedCloudflareFields(): CloudflareFieldType[] {
    return Object.values(this.vercelToCloudflare).filter((f) => f !== '') as CloudflareFieldType[]
  }

  /**
   * Get all supported Vercel types
   */
  public static getSupportedVercelTypes(): VercelRuleType[] {
    return Object.keys(this.vercelToCloudflare).filter((type) =>
      this.isCloudflareSupported(type as VercelRuleType),
    ) as VercelRuleType[]
  }
}
