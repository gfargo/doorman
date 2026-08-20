import { logger } from '../../logger'
import { FastlyClient } from './FastlyClient'
import { FastlyFirewallService } from './FastlyFirewallService'
import type { IFirewallProvider } from '../IFirewallProvider'

export interface FastlyProviderConfig {
  apiToken?: string
  workspaceId?: string
}

/**
 * Fastly Provider Factory.
 * Creates and configures Fastly Next-Gen WAF firewall provider instances —
 * mirrors `VercelProvider`/`CloudflareProvider`.
 */
export class FastlyProvider {
  /**
   * Create provider from environment variables.
   */
  static fromEnv(): IFirewallProvider {
    const apiToken = process.env.FASTLY_API_TOKEN
    const workspaceId = process.env.FASTLY_WORKSPACE_ID

    if (!apiToken) {
      throw new Error('FASTLY_API_TOKEN environment variable is required')
    }

    if (!workspaceId) {
      throw new Error('FASTLY_WORKSPACE_ID environment variable is required')
    }

    const client = new FastlyClient(workspaceId, apiToken)
    return new FastlyFirewallService(client)
  }

  /**
   * Create provider from explicit configuration.
   */
  static fromConfig(config: FastlyProviderConfig): IFirewallProvider {
    const apiToken = config.apiToken || process.env.FASTLY_API_TOKEN
    const workspaceId = config.workspaceId || process.env.FASTLY_WORKSPACE_ID

    if (!apiToken) {
      throw new Error('Fastly API token is required (provide apiToken or set FASTLY_API_TOKEN env var)')
    }

    if (!workspaceId) {
      throw new Error('Fastly workspace ID is required (provide workspaceId or set FASTLY_WORKSPACE_ID env var)')
    }

    logger.debug('Creating Fastly provider with config:', { workspaceId })

    const client = new FastlyClient(workspaceId, apiToken)
    return new FastlyFirewallService(client)
  }

  /**
   * Create provider with explicit credentials.
   */
  static create(workspaceId: string, apiToken: string): IFirewallProvider {
    return this.fromConfig({ workspaceId, apiToken })
  }
}
