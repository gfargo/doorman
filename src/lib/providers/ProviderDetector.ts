import { logger } from '../logger'
import { PROVIDER_TYPES, type ProviderType } from './IFirewallProvider'
import { CREDENTIAL_DESCRIPTORS } from './credentials'
import type { CredentialField } from './credentials'

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
   * The field whose presence signals "this provider's credentials are
   * configured" — its one required, non-secret field (has a `configKey`, so
   * it's legal to live in a config file at all; secrets like API tokens
   * never do). Every provider's descriptor has exactly one such field today
   * (Vercel's `projectId`, Cloudflare's `zoneId`, Fastly's `workspaceId`) —
   * this generalizes that instead of hardcoding each provider's field name
   * here, in the descriptor, and in three other places (see #182).
   */
  private static detectionField(provider: ProviderType): CredentialField | undefined {
    return CREDENTIAL_DESCRIPTORS[provider].fields.find((field) => field.required && field.configKey)
  }

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

    // 2. Check for provider-specific configuration — iterates PROVIDER_TYPES
    // (declared order: vercel, cloudflare, fastly) rather than the previous
    // hand-written cloudflare-then-vercel-then-fastly order. No test pinned
    // that order, and it never matched PROVIDER_TYPES' own order to begin
    // with; only matters if a config somehow declares more than one
    // provider's credentials at once, which isn't a real scenario doorman
    // supports.
    if (config && 'providers' in config && typeof config.providers === 'object' && config.providers !== null) {
      const providers = config.providers as Record<string, unknown>
      for (const providerType of PROVIDER_TYPES) {
        const field = this.detectionField(providerType)
        if (!field?.configKey) continue
        const providerConfig = (providers[providerType] || {}) as Record<string, unknown>
        if (typeof providerConfig[field.configKey] === 'string') {
          reasons.push(`${field.label} found in config`)
          return {
            provider: providerType,
            confidence: 'high',
            reasons,
          }
        }
      }
    }

    // 3. Check legacy Vercel config format (v1) — Vercel-specific and
    // predates the providers.<name> block; no equivalent exists (or should
    // exist) for any other provider.
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

    // Same detection field as the config check above, but keyed off its
    // envVar. Matches every provider at 'medium' confidence, same as the
    // previous hardcoded per-provider checks did regardless of whether the
    // paired secret credential's env var was also set — that distinction
    // only ever changed the reason text, never the confidence level.
    for (const providerType of PROVIDER_TYPES) {
      const field = this.detectionField(providerType)
      if (!field || !process.env[field.envVar]) continue
      reasons.push(`${field.label} found in environment (${field.envVar})`)
      return {
        provider: providerType,
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
      for (const providerType of PROVIDER_TYPES) {
        const field = this.detectionField(providerType)
        if (!field?.configKey) continue
        const providerConfig = (providersCfg[providerType] || {}) as Record<string, unknown>
        if (typeof providerConfig[field.configKey] === 'string') {
          providers.add(providerType)
        }
      }
    }

    // Check legacy Vercel config
    if (config && 'projectId' in config && typeof config.projectId === 'string') {
      providers.add('vercel')
    }

    // Check environment
    for (const providerType of PROVIDER_TYPES) {
      const field = this.detectionField(providerType)
      if (field && process.env[field.envVar]) {
        providers.add(providerType)
      }
    }

    return Array.from(providers)
  }
}
