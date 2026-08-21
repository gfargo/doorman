import { logger } from '../../logger'
import { VercelClient } from './VercelClient'
import { VercelFirewallService } from './VercelFirewallService'
import type { IFirewallProvider } from '../IFirewallProvider'

export interface VercelProviderConfig {
  token?: string
  projectId?: string
  teamId?: string
}

/**
 * Vercel Provider Factory
 * Creates and configures Vercel firewall provider instances
 */
export class VercelProvider {
  /**
   * Create provider from environment variables
   */
  static fromEnv(): IFirewallProvider {
    const token = process.env.VERCEL_TOKEN
    const projectId = process.env.VERCEL_PROJECT_ID
    const teamId = process.env.VERCEL_TEAM_ID

    if (!token) {
      throw new Error('VERCEL_TOKEN environment variable is required')
    }

    if (!projectId) {
      throw new Error('VERCEL_PROJECT_ID environment variable is required')
    }

    // teamId is intentionally not validated here — omitting it lets Vercel
    // resolve the request against the token's default team, which is fine
    // for anyone with just one team. Explicit teamId only matters for
    // callers that belong to more than one and want a non-default one.
    const client = new VercelClient(projectId, teamId, token)
    return new VercelFirewallService(client)
  }

  /**
   * Create provider from explicit configuration
   */
  static fromConfig(config: VercelProviderConfig): IFirewallProvider {
    const token = config.token || process.env.VERCEL_TOKEN
    const projectId = config.projectId || process.env.VERCEL_PROJECT_ID
    const teamId = config.teamId || process.env.VERCEL_TEAM_ID

    if (!token) {
      throw new Error('Vercel API token is required (provide token or set VERCEL_TOKEN env var)')
    }

    if (!projectId) {
      throw new Error('Vercel project ID is required (provide projectId or set VERCEL_PROJECT_ID env var)')
    }

    // teamId is intentionally not validated here — see fromEnv() above.
    logger.debug('Creating Vercel provider with config:', {
      projectId,
      teamId,
    })

    const client = new VercelClient(projectId, teamId, token)
    return new VercelFirewallService(client)
  }

  /**
   * Create provider with explicit credentials
   */
  static create(projectId: string, teamId: string, token: string): IFirewallProvider {
    return this.fromConfig({ projectId, teamId, token })
  }
}
