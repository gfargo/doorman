import { LogLevels } from 'consola'
import { logger } from '../logger'
import type { IFirewallProvider, ProviderType } from '../providers/IFirewallProvider'
import { FirewallConfig } from '../types'
import { getConfig } from './config'
import { handleCommandError } from './handleCommandError'
import { getProviderInstance } from './providerHelper'

/**
 * Context provided to command handlers by `withCredentials`.
 */
export interface CommandContext {
  /** The loaded config (FirewallConfig for legacy, may be UnifiedConfig for multi-provider) */
  config: FirewallConfig
  /** The resolved provider instance (works for both Vercel and Cloudflare) */
  provider: IFirewallProvider
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
  /** CLI --apiToken override (Cloudflare, also reused for Fastly's API token) */
  apiToken?: string
  /** CLI --zoneId override (Cloudflare) */
  zoneId?: string
  /** CLI --accountId override (Cloudflare) */
  accountId?: string
  /** CLI --workspaceId override (Fastly) */
  workspaceId?: string
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
      // Fastly credentials
      workspaceId: options.workspaceId,
    })

    // Resolved Vercel credentials, when applicable — some commands (e.g.
    // backup) still want the raw token/projectId/teamId alongside `provider`.
    const token = vercelCredentials?.token ?? ''
    const projectId = vercelCredentials?.projectId ?? ''
    const teamId = vercelCredentials?.teamId ?? ''

    await handler({ config, provider, token, projectId, teamId })
  } catch (error) {
    handleCommandError(error, options.errorContext)
  }
}
