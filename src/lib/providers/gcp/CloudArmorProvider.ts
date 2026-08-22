import { logger } from '../../logger'
import { CloudArmorClient } from './CloudArmorClient'
import { CloudArmorFirewallService } from './CloudArmorFirewallService'
import type { IFirewallProvider } from '../IFirewallProvider'

export interface CloudArmorProviderConfig {
  projectId?: string
  policyName?: string
  /** Optional — omitted, GoogleAuth falls through to Application Default Credentials. See credentials.ts. */
  serviceAccountKeyPath?: string
}

/**
 * GCP Cloud Armor Provider Factory.
 * Creates and configures Cloud Armor firewall provider instances — mirrors
 * `VercelProvider`/`CloudflareProvider`/`FastlyProvider`.
 */
export class CloudArmorProvider {
  /**
   * Create provider from environment variables.
   */
  static fromEnv(): IFirewallProvider {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT
    const policyName = process.env.GCP_POLICY_NAME
    const serviceAccountKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

    if (!projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required')
    }
    if (!policyName) {
      throw new Error('GCP_POLICY_NAME environment variable is required')
    }

    const client = new CloudArmorClient(projectId, policyName, serviceAccountKeyPath)
    return new CloudArmorFirewallService(client)
  }

  /**
   * Create provider from explicit configuration.
   */
  static fromConfig(config: CloudArmorProviderConfig): IFirewallProvider {
    const projectId = config.projectId || process.env.GOOGLE_CLOUD_PROJECT
    const policyName = config.policyName || process.env.GCP_POLICY_NAME
    const serviceAccountKeyPath = config.serviceAccountKeyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS

    if (!projectId) {
      throw new Error('GCP project ID is required (provide projectId or set GOOGLE_CLOUD_PROJECT env var)')
    }
    if (!policyName) {
      throw new Error('Cloud Armor policy name is required (provide policyName or set GCP_POLICY_NAME env var)')
    }

    logger.debug('Creating Cloud Armor provider with config:', { projectId, policyName })

    const client = new CloudArmorClient(projectId, policyName, serviceAccountKeyPath)
    return new CloudArmorFirewallService(client)
  }

  /**
   * Create provider with explicit credentials.
   */
  static create(projectId: string, policyName: string, serviceAccountKeyPath?: string): IFirewallProvider {
    return this.fromConfig({ projectId, policyName, serviceAccountKeyPath })
  }
}
