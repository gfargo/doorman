import { LogLevels } from 'consola'
import { logger } from '../logger'
import type { IFirewallProvider, ProviderType } from '../providers/IFirewallProvider'
import { FirewallService } from '../services/FirewallService'
import { VercelClient } from '../services/VercelClient'
import { FirewallConfig } from '../types'
import { getConfig } from './config'
import { handleCommandError } from './handleCommandError'
import { getProviderInstance } from './providerHelper'

/**
 * Context provided to command handlers by `withCredentials`.
 *
 * For Vercel (legacy) usage, `client` and `service` are available.
 * For multi-provider usage, use `provider` which implements `IFirewallProvider`.
 * Both are always populated — `provider` wraps the Vercel client when in legacy mode.
 */
export interface CommandContext {
  /** The loaded config (FirewallConfig for legacy, may be UnifiedConfig for multi-provider) */
  config: FirewallConfig
  /** The resolved provider instance (works for both Vercel and Cloudflare) */
  provider: IFirewallProvider
  /** @deprecated Use `provider` instead. Vercel client (only populated for Vercel provider) */
  client: VercelClient
  /** @deprecated Use `provider` instead. Vercel firewall service (only populated for Vercel provider) */
  service: FirewallService
  /** Resolved credentials */
  token: string
  projectId: string
  teamId: string
}

/**
 * Options controlling how `withCredentials` loads config and resolves credentials.
 */
export interface WithCredentialsOptions {
  /** CLI --config path */
  config?: string
  /** Explicit provider selection (auto-detected if not specified) */
  provider?: ProviderType
  /** CLI --projectId override (Vercel) */
  projectId?: string
  /** CLI --teamId override (Vercel) */
  teamId?: string
  /** CLI --token override (Vercel) */
  token?: string
  /** CLI --apiToken override (Cloudflare) */
  apiToken?: string
  /** CLI --zoneId override (Cloudflare) */
  zoneId?: string
  /** CLI --accountId override (Cloudflare) */
  accountId?: string
  /** CLI --debug flag */
  debug?: boolean
  /** CLI --ci flag (non-interactive mode) */
  ci?: boolean
  /**
   * If true, config file is optional — missing/invalid configs are silently
   * ignored and an empty partial config is used for credential resolution.
   */
  optionalConfig?: boolean
  /**
   * If true, config is loaded without schema validation.
   */
  skipValidation?: boolean
  /** Context string for error messages (e.g., 'syncing firewall rules') */
  errorContext: string
}

/**
 * Shared middleware that handles config loading, provider detection, credential
 * resolution, and error handling for all CLI commands.
 *
 * Supports both legacy Vercel-only usage and multi-provider (Vercel/Cloudflare) usage.
 * Provider is auto-detected from config/environment when not explicitly specified.
 */
export async function withCredentials(
  options: WithCredentialsOptions,
  handler: (ctx: CommandContext) => Promise<void>,
): Promise<void> {
  try {
    if (options.debug) {
      logger.level = LogLevels.debug
    }

    // 1. Load config
    let config: FirewallConfig

    if (options.optionalConfig) {
      try {
        config = await getConfig(options.config, 'optional')
      } catch {
        config = {} as FirewallConfig
      }
    } else if (options.skipValidation) {
      config = await getConfig(options.config, 'raw')
    } else {
      config = await getConfig(options.config, 'required')
    }

    // 2. Get provider instance (handles credential resolution for both providers)
    const { provider, vercelCredentials } = await getProviderInstance({
      provider: options.provider,
      config,
      interactive: !options.ci,
      // Vercel credentials
      token: options.token,
      projectId: options.projectId,
      teamId: options.teamId,
      // Cloudflare credentials
      apiToken: options.apiToken,
      zoneId: options.zoneId,
      accountId: options.accountId,
    })

    // 3. For backward compatibility, also create legacy Vercel client/service
    //    These are only meaningful when the provider is Vercel.
    let client: VercelClient
    let service: FirewallService
    let token = ''
    let projectId = ''
    let teamId = ''

    if (provider.name === 'vercel' && vercelCredentials) {
      // Reuse the credentials getProviderInstance already resolved above —
      // re-resolving here via promptForCredentials would ask an interactive
      // user for the same token/projectId/teamId a second time.
      token = vercelCredentials.token
      projectId = vercelCredentials.projectId
      teamId = vercelCredentials.teamId
      client = new VercelClient(projectId, teamId, token)
      service = new FirewallService(client)
    } else {
      // For non-Vercel providers, create stub instances
      // Commands should use `provider` instead
      client = {} as VercelClient
      service = {} as FirewallService
    }

    await handler({ config, provider, client, service, token, projectId, teamId })
  } catch (error) {
    handleCommandError(error, options.errorContext)
  }
}
