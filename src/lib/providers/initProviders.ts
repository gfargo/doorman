import { getProviderRegistry } from './ProviderRegistry'
import { CloudflareProvider } from './cloudflare'
import { VercelProvider } from './vercel'
import { logger } from '../logger'
import type { ProviderType } from './IFirewallProvider'

/**
 * Initialize and register all available providers
 * This should be called once at application startup
 */
export function initProviders(): void {
  const registry = getProviderRegistry()

  // Register Vercel provider factory
  registry.register('vercel', () => {
    logger.debug('Initializing Vercel provider')
    return VercelProvider.fromEnv()
  })

  // Register Cloudflare provider factory
  registry.register('cloudflare', () => {
    logger.debug('Initializing Cloudflare provider')
    return CloudflareProvider.fromEnv()
  })

  logger.debug('Provider registry initialized')
}

/**
 * Get a provider instance with automatic initialization
 */
export async function getProvider(
  providerType: ProviderType,
  config?: Record<string, unknown>,
): Promise<import('./IFirewallProvider').IFirewallProvider> {
  const registry = getProviderRegistry()

  // Ensure providers are initialized
  if (!registry.has(providerType)) {
    initProviders()
  }

  // For Vercel with custom config
  if (providerType === 'vercel' && config) {
    const vercelConfig = config as { token?: string; projectId?: string; teamId?: string }
    return VercelProvider.fromConfig(vercelConfig)
  }

  // For Cloudflare with custom config
  if (providerType === 'cloudflare' && config) {
    const cfConfig = config as { apiToken?: string; zoneId?: string; accountId?: string }
    return CloudflareProvider.fromConfig(cfConfig)
  }

  // Get from registry
  return registry.get(providerType)
}
