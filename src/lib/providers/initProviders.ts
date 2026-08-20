import { getProviderRegistry } from './ProviderRegistry'
import { CloudflareProvider } from './cloudflare'
import { VercelProvider } from './vercel'
import { FastlyProvider } from './fastly'
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

  // Register Fastly provider factory
  registry.register('fastly', () => {
    logger.debug('Initializing Fastly provider')
    return FastlyProvider.fromEnv()
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

  // For Fastly with custom config
  if (providerType === 'fastly' && config) {
    const fastlyConfig = config as { apiToken?: string; workspaceId?: string }
    return FastlyProvider.fromConfig(fastlyConfig)
  }

  // Get from registry
  return registry.get(providerType)
}
