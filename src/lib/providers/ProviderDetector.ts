import { logger } from '../logger'
import { PROVIDER_TYPES, type ProviderType } from './IFirewallProvider'

/**
 * Provider detection result
 */
export interface DetectionResult {
  provider: ProviderType | null
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}

/**
 * Provider detector utility
 * Automatically detects which firewall provider to use based on configuration and environment
 */
export class ProviderDetector {
  /**
   * Detect provider from configuration and environment
   * @param config - Configuration object (partial or complete)
   * @returns Detected provider type or null if unable to detect
   */
  public static detect(config?: Record<string, unknown>): DetectionResult {
    const reasons: string[] = []

    // 1. Check explicit provider field in config
    if (config && 'provider' in config) {
      const providerVal = config.provider
      if (typeof providerVal === 'string' && this.isValidProvider(providerVal)) {
        reasons.push(`Explicit provider specified in config: ${config.provider}`)
        return {
          provider: providerVal as ProviderType,
          confidence: 'high',
          reasons,
        }
      } else {
        logger.warn(`Invalid provider specified in config: ${String((config as Record<string, unknown>).provider)}`)
      }
    }

    // 2. Check for provider-specific configuration
    if (config && 'providers' in config && typeof config.providers === 'object' && config.providers !== null) {
      // Check for Cloudflare config
      const providers = config.providers as Record<string, unknown>
      const cloudflare = (providers.cloudflare || {}) as Record<string, unknown>
      if (typeof cloudflare.zoneId === 'string') {
        reasons.push('Cloudflare zone ID found in config')
        return {
          provider: 'cloudflare',
          confidence: 'high',
          reasons,
        }
      }

      // Check for Vercel config
      const vercel = (providers.vercel || {}) as Record<string, unknown>
      if (typeof vercel.projectId === 'string') {
        reasons.push('Vercel project ID found in config')
        return {
          provider: 'vercel',
          confidence: 'high',
          reasons,
        }
      }
    }

    // 3. Check legacy Vercel config format (v1)
    if (config && 'projectId' in config && typeof config.projectId === 'string') {
      reasons.push('Legacy Vercel project ID found in config')
      return {
        provider: 'vercel',
        confidence: 'high',
        reasons,
      }
    }

    // 4. Check environment variables
    const envProvider = this.detectFromEnvironment()
    if (envProvider.provider) {
      return envProvider
    }

    // 5. Unable to detect
    logger.debug('Unable to auto-detect provider')
    return {
      provider: null,
      confidence: 'low',
      reasons: ['No provider information found in config or environment'],
    }
  }

  /**
   * Detect provider from environment variables
   */
  private static detectFromEnvironment(): DetectionResult {
    const reasons: string[] = []

    // Check explicit provider env var
    const envProvider = process.env.DOORMAN_PROVIDER
    if (envProvider && this.isValidProvider(envProvider)) {
      reasons.push(`Provider set via DOORMAN_PROVIDER environment variable: ${envProvider}`)
      return {
        provider: envProvider as ProviderType,
        confidence: 'high',
        reasons,
      }
    }

    // Check Cloudflare env vars
    if (process.env.CLOUDFLARE_ZONE_ID && process.env.CLOUDFLARE_API_TOKEN) {
      reasons.push('Cloudflare credentials found in environment variables')
      return {
        provider: 'cloudflare',
        confidence: 'medium',
        reasons,
      }
    }

    if (process.env.CLOUDFLARE_ZONE_ID) {
      reasons.push('Cloudflare zone ID found in environment')
      return {
        provider: 'cloudflare',
        confidence: 'medium',
        reasons,
      }
    }

    // Check Vercel env vars
    if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_TOKEN) {
      reasons.push('Vercel credentials found in environment variables')
      return {
        provider: 'vercel',
        confidence: 'medium',
        reasons,
      }
    }

    if (process.env.VERCEL_PROJECT_ID) {
      reasons.push('Vercel project ID found in environment')
      return {
        provider: 'vercel',
        confidence: 'medium',
        reasons,
      }
    }

    return {
      provider: null,
      confidence: 'low',
      reasons: ['No provider credentials found in environment'],
    }
  }

  /**
   * Validate provider type string
   */
  private static isValidProvider(provider: string): boolean {
    return (PROVIDER_TYPES as readonly string[]).includes(provider)
  }

  /**
   * Get provider from config or environment with fallback
   * @param config - Configuration object
   * @param fallback - Fallback provider if detection fails
   * @returns Detected or fallback provider
   */
  public static getProvider(config?: Record<string, unknown>, fallback: ProviderType = 'vercel'): ProviderType {
    const result = this.detect(config)

    if (result.provider) {
      logger.debug(`Provider detected: ${result.provider} (${result.confidence} confidence)`)
      if (result.reasons.length > 0) {
        logger.debug(`Detection reasons: ${result.reasons.join(', ')}`)
      }
      return result.provider
    }

    logger.debug(`No provider detected, using fallback: ${fallback}`)
    return fallback
  }

  /**
   * Detect all possible providers from config and environment
   * Useful for migration scenarios
   */
  public static detectAll(config?: Record<string, unknown>): ProviderType[] {
    const providers: Set<ProviderType> = new Set()

    // Check explicit provider
    if (config && 'provider' in config) {
      const providerVal = config.provider
      if (typeof providerVal === 'string' && this.isValidProvider(providerVal)) {
        providers.add(providerVal as ProviderType)
      }
    }

    // Check provider-specific configs
    if (config && 'providers' in config && typeof config.providers === 'object' && config.providers !== null) {
      const providersCfg = config.providers as Record<string, unknown>
      const cloudflare = (providersCfg.cloudflare || {}) as Record<string, unknown>
      if (typeof cloudflare.zoneId === 'string') {
        providers.add('cloudflare')
      }
      const vercel = (providersCfg.vercel || {}) as Record<string, unknown>
      if (typeof vercel.projectId === 'string') {
        providers.add('vercel')
      }
    }

    // Check legacy Vercel config
    if (config && 'projectId' in config && typeof config.projectId === 'string') {
      providers.add('vercel')
    }

    // Check environment
    if (process.env.CLOUDFLARE_ZONE_ID) {
      providers.add('cloudflare')
    }
    if (process.env.VERCEL_PROJECT_ID) {
      providers.add('vercel')
    }

    return Array.from(providers)
  }
}
