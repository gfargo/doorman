import type { ProviderType } from '../providers/IFirewallProvider'
import type { VercelRuleType } from '../types/vercel'
import type { ActionType } from '../types/common'

/**
 * Compatibility level for features
 */
export type CompatibilityLevel = 'full' | 'partial' | 'not-supported'

/**
 * Feature compatibility information
 */
export interface FeatureCompatibility {
  level: CompatibilityLevel
  notes?: string
  limitations?: string[]
}

/**
 * Feature Compatibility Matrix
 * Defines what features are supported by each provider
 */
export class CompatibilityMatrix {
  /**
   * Action type compatibility
   */
  private static readonly actionCompatibility: Record<ActionType, Record<ProviderType, FeatureCompatibility>> = {
    log: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full' },
      fastly: {
        level: 'partial',
        notes: 'No dedicated action; maps to "allow"',
        limitations: ['request_logging is set at the rule level, not per-action'],
      },
      gcp: {
        level: 'partial',
        notes: 'No dedicated log action; represented via preview: true on a rule',
        limitations: ['A previewed rule evaluates and logs but never enforces, regardless of its actual action'],
      },
    },
    deny: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'Maps to "block" action' },
      fastly: { level: 'full', notes: 'Maps to "block" action' },
      gcp: { level: 'full', notes: 'Maps to "deny(403)"' },
    },
    block: {
      vercel: { level: 'not-supported' },
      cloudflare: { level: 'full' },
      fastly: { level: 'full' },
      gcp: { level: 'full', notes: 'Maps to "deny(403)"' },
    },
    challenge: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'Maps to "managed_challenge" for better accuracy' },
      fastly: { level: 'full', notes: 'Maps to "browser_challenge" action' },
      gcp: {
        level: 'not-supported',
        notes:
          'Cloud Armor has reCAPTCHA integration via redirectOptions/rateLimitOptions.exceedRedirectOptions, but no standalone challenge action for ordinary custom rules',
      },
    },
    bypass: {
      vercel: { level: 'full' },
      cloudflare: { level: 'partial', notes: 'Maps to "skip" action', limitations: ['Limited skip options'] },
      fastly: { level: 'partial', notes: 'No equivalent action; maps to "allow"' },
      gcp: { level: 'partial', notes: 'No dedicated bypass action; maps to "allow"' },
    },
    rate_limit: {
      vercel: { level: 'full' },
      cloudflare: {
        level: 'full',
        notes: 'Uses separate rate limit configuration',
        limitations: ['Different configuration format'],
      },
      fastly: {
        level: 'full',
        notes: 'Uses a distinct rule type ("rate_limit") with its own rate_limit block',
        limitations: ['Requires a pre-existing custom signal to count against'],
      },
      gcp: {
        level: 'full',
        notes: 'Uses "throttle" or "rate_based_ban" action with a rateLimitOptions block',
      },
    },
    redirect: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full' },
      fastly: { level: 'full' },
      gcp: { level: 'full', notes: 'Uses "redirect" action with a redirectOptions block' },
    },
    allow: {
      vercel: { level: 'not-supported' },
      cloudflare: { level: 'full' },
      fastly: { level: 'full' },
      gcp: { level: 'full' },
    },
  }

  /**
   * Field type compatibility (Vercel → Providers)
   */
  private static readonly fieldCompatibility: Record<VercelRuleType, Record<ProviderType, FeatureCompatibility>> = {
    host: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'http.host' },
      fastly: { level: 'full', notes: 'Maps to the "domain" condition field' },
      gcp: { level: 'full', notes: "request.headers['host'], guarded by has()" },
    },
    path: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'http.request.uri.path' },
      fastly: { level: 'full' },
      gcp: { level: 'full', notes: 'request.path' },
    },
    method: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'http.request.method' },
      fastly: { level: 'full' },
      gcp: { level: 'full', notes: 'request.method' },
    },
    header: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'http.request.headers["name"]' },
      fastly: { level: 'full', notes: 'Maps to a "request_header" multival condition' },
      gcp: { level: 'full', notes: "request.headers['name'], guarded by has()" },
    },
    query: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'http.request.uri.query' },
      fastly: { level: 'full', notes: 'Maps to a "query_parameter" multival condition' },
      gcp: { level: 'full', notes: 'request.query — raw, undecoded query string, same shape as Cloudflare’s' },
    },
    cookie: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'http.cookie' },
      fastly: { level: 'full', notes: 'Maps to a "request_cookie" multival condition' },
      gcp: {
        level: 'partial',
        notes:
          "No parsed cookie map — a keyed condition composes a 'key=value' substring search against the raw Cookie header",
        limitations: ['Only eq/ne/contains/not_contains are representable for a condition naming a specific cookie'],
      },
    },
    target_path: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'Maps to http.request.uri.path' },
      fastly: { level: 'not-supported', notes: 'No Fastly equivalent condition field' },
      gcp: { level: 'not-supported', notes: "Not currently mapped by doorman's Cloud Armor translator" },
    },
    ip_address: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'ip.src' },
      fastly: { level: 'full', notes: 'Maps to the "ip" condition field' },
      gcp: { level: 'full', notes: 'origin.ip / inIpRange(origin.ip, cidr)' },
    },
    region: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'ip.geoip.subdivision_1' },
      fastly: { level: 'not-supported', notes: 'Fastly only exposes country-level geo matching' },
      gcp: { level: 'not-supported', notes: 'Cloud Armor has no region/subdivision-level geo attribute' },
    },
    protocol: {
      vercel: { level: 'full' },
      cloudflare: { level: 'partial', notes: 'Maps to ssl boolean', limitations: ['Only checks HTTPS vs HTTP'] },
      fastly: { level: 'not-supported', notes: 'No Fastly equivalent condition field' },
      gcp: { level: 'not-supported', notes: 'No confirmed Cloud Armor CEL field for scheme/protocol' },
    },
    scheme: {
      vercel: { level: 'full' },
      cloudflare: { level: 'partial', notes: 'Maps to ssl boolean', limitations: ['Only checks HTTPS vs HTTP'] },
      fastly: { level: 'full', notes: 'Maps to the "scheme" condition field' },
      gcp: { level: 'not-supported', notes: 'No confirmed Cloud Armor CEL field for scheme/protocol' },
    },
    environment: {
      vercel: { level: 'full' },
      cloudflare: { level: 'not-supported', notes: 'Vercel-specific feature' },
      fastly: { level: 'not-supported', notes: 'Vercel-specific feature' },
      gcp: { level: 'not-supported', notes: 'Vercel-specific feature' },
    },
    user_agent: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'http.user_agent' },
      fastly: { level: 'full' },
      gcp: { level: 'full', notes: "request.headers['user-agent'], guarded by has()" },
    },
    geo_continent: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'ip.geoip.continent' },
      fastly: { level: 'not-supported', notes: 'Fastly only exposes country-level geo matching' },
      gcp: { level: 'not-supported', notes: 'Cloud Armor has no continent-level geo attribute' },
    },
    geo_country: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'ip.geoip.country' },
      fastly: { level: 'full', notes: 'Maps to the "country" condition field' },
      gcp: { level: 'full', notes: 'origin.region_code' },
    },
    geo_country_region: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'ip.geoip.subdivision_1' },
      fastly: { level: 'not-supported', notes: 'Fastly only exposes country-level geo matching' },
      gcp: { level: 'not-supported', notes: 'Cloud Armor has no region/subdivision-level geo attribute' },
    },
    geo_city: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'ip.geoip.city' },
      fastly: { level: 'not-supported', notes: 'Fastly only exposes country-level geo matching' },
      gcp: { level: 'not-supported', notes: 'Cloud Armor has no city-level geo attribute' },
    },
    geo_as_number: {
      vercel: { level: 'full' },
      cloudflare: { level: 'full', notes: 'ip.geoip.asnum' },
      fastly: { level: 'not-supported', notes: 'No Fastly equivalent condition field' },
      gcp: { level: 'full', notes: 'origin.asn' },
    },
    ja4_digest: {
      vercel: { level: 'full' },
      cloudflare: { level: 'not-supported', notes: 'Vercel-specific feature' },
      fastly: { level: 'not-supported', notes: "Not currently mapped by doorman's Fastly translator" },
      gcp: {
        level: 'not-supported',
        notes: "Cloud Armor exposes origin.tls_ja4_fingerprint, but it is not currently mapped by doorman's translator",
      },
    },
    ja3_digest: {
      vercel: { level: 'full' },
      cloudflare: { level: 'not-supported', notes: 'Vercel-specific feature' },
      fastly: {
        level: 'not-supported',
        notes:
          "Fastly exposes a JA3 fingerprint condition field, but it is not currently mapped by doorman's translator",
      },
      gcp: {
        level: 'not-supported',
        notes: "Cloud Armor exposes origin.tls_ja3_fingerprint, but it is not currently mapped by doorman's translator",
      },
    },
    rate_limit_api_id: {
      vercel: { level: 'full' },
      cloudflare: { level: 'not-supported', notes: 'Vercel-specific feature' },
      fastly: { level: 'not-supported', notes: 'Vercel-specific feature' },
      gcp: { level: 'not-supported', notes: 'Vercel-specific feature' },
    },
  }

  /**
   * Get action compatibility for a provider
   */
  public static getActionCompatibility(action: ActionType, provider: ProviderType): FeatureCompatibility {
    return (
      this.actionCompatibility[action]?.[provider] || {
        level: 'not-supported',
        notes: 'Unknown action type',
      }
    )
  }

  /**
   * Get field compatibility for a provider
   */
  public static getFieldCompatibility(field: VercelRuleType, provider: ProviderType): FeatureCompatibility {
    return (
      this.fieldCompatibility[field]?.[provider] || {
        level: 'not-supported',
        notes: 'Unknown field type',
      }
    )
  }

  /**
   * Check if an action is supported by a provider
   */
  public static isActionSupported(action: ActionType, provider: ProviderType): boolean {
    const compatibility = this.getActionCompatibility(action, provider)
    return compatibility.level !== 'not-supported'
  }

  /**
   * Check if a field is supported by a provider
   */
  public static isFieldSupported(field: VercelRuleType, provider: ProviderType): boolean {
    const compatibility = this.getFieldCompatibility(field, provider)
    return compatibility.level !== 'not-supported'
  }

  /**
   * Get all unsupported actions for a provider
   */
  public static getUnsupportedActions(provider: ProviderType): ActionType[] {
    return Object.entries(this.actionCompatibility)
      .filter(([_, providers]) => providers[provider].level === 'not-supported')
      .map(([action]) => action as ActionType)
  }

  /**
   * Get all unsupported fields for a provider
   */
  public static getUnsupportedFields(provider: ProviderType): VercelRuleType[] {
    return Object.entries(this.fieldCompatibility)
      .filter(([_, providers]) => providers[provider].level === 'not-supported')
      .map(([field]) => field as VercelRuleType)
  }

  /**
   * Get compatibility report for migrating from one provider to another
   */
  public static getMigrationReport(
    fromProvider: ProviderType,
    toProvider: ProviderType,
  ): {
    fullySupported: string[]
    partiallySupported: string[]
    notSupported: string[]
    warnings: string[]
  } {
    const fullySupported: string[] = []
    const partiallySupported: string[] = []
    const notSupported: string[] = []
    const warnings: string[] = []

    // Check actions
    for (const [action, providers] of Object.entries(this.actionCompatibility)) {
      const fromCompat = providers[fromProvider]
      const toCompat = providers[toProvider]

      if (fromCompat.level !== 'not-supported') {
        if (toCompat.level === 'full') {
          fullySupported.push(`Action: ${action}`)
        } else if (toCompat.level === 'partial') {
          partiallySupported.push(`Action: ${action}`)
          if (toCompat.notes) warnings.push(`${action}: ${toCompat.notes}`)
        } else {
          notSupported.push(`Action: ${action}`)
          warnings.push(`${action} is not supported in ${toProvider}`)
        }
      }
    }

    // Check fields
    for (const [field, providers] of Object.entries(this.fieldCompatibility)) {
      const fromCompat = providers[fromProvider]
      const toCompat = providers[toProvider]

      if (fromCompat.level !== 'not-supported') {
        if (toCompat.level === 'full') {
          fullySupported.push(`Field: ${field}`)
        } else if (toCompat.level === 'partial') {
          partiallySupported.push(`Field: ${field}`)
          if (toCompat.notes) warnings.push(`${field}: ${toCompat.notes}`)
        } else {
          notSupported.push(`Field: ${field}`)
          warnings.push(`${field} is not supported in ${toProvider}`)
        }
      }
    }

    return {
      fullySupported,
      partiallySupported,
      notSupported,
      warnings,
    }
  }
}
