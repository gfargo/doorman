import chalk from 'chalk'
import { logger } from '../logger'
import { prompt } from '../ui/prompt'
import { ProviderDetector } from '../providers/ProviderDetector'
import { VercelProvider } from '../providers/vercel'
import { CloudflareProvider } from '../providers/cloudflare'
import type { IFirewallProvider, ProviderType } from '../providers/IFirewallProvider'
import type { FirewallConfig, UnifiedConfig } from '../types'
import { isUnifiedConfig } from '../types'

export interface ProviderOptions {
  // Common options
  provider?: ProviderType
  config?: FirewallConfig | UnifiedConfig | Partial<FirewallConfig> | Partial<UnifiedConfig>
  interactive?: boolean

  // Vercel-specific
  token?: string
  projectId?: string
  teamId?: string

  // Cloudflare-specific
  apiToken?: string
  zoneId?: string
  accountId?: string
}

export interface ProviderInstanceResult {
  provider: IFirewallProvider
  /**
   * Resolved Vercel credentials, populated only when `provider.name` is
   * `'vercel'`. Callers that need the raw token/projectId/teamId (e.g. for
   * legacy `VercelClient` construction) should use these rather than
   * re-resolving credentials themselves — resolution here may already have
   * prompted the user interactively, and prompting again would ask for the
   * same values a second time.
   */
  vercelCredentials?: { token: string; projectId: string; teamId: string }
}

/**
 * Get provider instance with automatic detection and credential prompting
 * @param options - Provider options including credentials and config
 * @returns The resolved provider, plus Vercel credentials when applicable
 */
export async function getProviderInstance(options: ProviderOptions): Promise<ProviderInstanceResult> {
  // 1. Determine which provider to use
  let providerType: ProviderType

  if (options.provider) {
    // Explicit provider specified
    providerType = options.provider
    logger.debug(`Using explicitly specified provider: ${providerType}`)
  } else {
    // Auto-detect from config or environment
    const detection = ProviderDetector.detect(options.config as Record<string, unknown> | undefined)

    if (detection.provider) {
      providerType = detection.provider
      logger.debug(`Auto-detected provider: ${providerType} (${detection.confidence} confidence)`)
      if (detection.reasons.length > 0) {
        logger.debug(`Reasons: ${detection.reasons.join(', ')}`)
      }
    } else if (options.interactive !== false) {
      // Prompt user to select provider
      providerType = await promptForProvider()
    } else {
      // Default to Vercel for backward compatibility
      providerType = 'vercel'
      logger.warn('No provider detected, defaulting to Vercel')
    }
  }

  // 2. Get provider instance with credentials
  try {
    if (providerType === 'vercel') {
      return await getVercelProvider(options)
    } else if (providerType === 'cloudflare') {
      const provider = await getCloudflareProvider(options)
      return { provider }
    } else {
      throw new Error(`Unknown provider: ${providerType}`)
    }
  } catch (error) {
    logger.error(`Failed to initialize ${providerType} provider:`, error)
    throw error
  }
}

/**
 * Get Vercel provider instance
 */
async function getVercelProvider(options: ProviderOptions): Promise<ProviderInstanceResult> {
  const token = options.token || process.env.VERCEL_TOKEN

  // Type guard for accessing Vercel-specific properties
  const vercelConfig =
    options.config && !isUnifiedConfig(options.config) ? (options.config as Partial<FirewallConfig>) : undefined
  const configProjectId = vercelConfig?.projectId
  const configTeamId = vercelConfig?.teamId

  const projectId = options.projectId || configProjectId || process.env.VERCEL_PROJECT_ID
  const teamId = options.teamId || configTeamId || process.env.VERCEL_TEAM_ID

  if (!token || !projectId || !teamId) {
    if (options.interactive === false) {
      throw new Error('Vercel credentials missing. Provide token, projectId, and teamId.')
    }

    logger.warn('Missing Vercel credentials')
    logger.info('Please provide your Vercel credentials:')

    // Import promptForCredentials only when needed
    const { promptForCredentials } = await import('../ui/promptForCredentials')
    const credentials = await promptForCredentials({
      token,
      projectId,
      teamId,
    })

    const provider = VercelProvider.fromConfig({
      token: credentials.token,
      projectId: credentials.projectId,
      teamId: credentials.teamId,
    })
    return { provider, vercelCredentials: credentials }
  }

  const provider = VercelProvider.fromConfig({
    token,
    projectId,
    teamId,
  })
  return { provider, vercelCredentials: { token, projectId, teamId } }
}

/**
 * Get Cloudflare provider instance
 */
async function getCloudflareProvider(options: ProviderOptions): Promise<IFirewallProvider> {
  const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN
  const zoneId = options.zoneId || process.env.CLOUDFLARE_ZONE_ID
  const accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID

  if (!apiToken || !zoneId) {
    if (options.interactive === false) {
      throw new Error('Cloudflare credentials missing. Provide apiToken and zoneId.')
    }

    logger.warn('Missing Cloudflare credentials')
    logger.info('Please provide your Cloudflare credentials:')

    const apiTokenInput =
      apiToken ||
      (await prompt('Cloudflare API Token:', {
        type: 'text',
      }))

    const zoneIdInput =
      zoneId ||
      (await prompt('Cloudflare Zone ID:', {
        type: 'text',
      }))

    const accountIdInput =
      accountId ||
      (await prompt('Cloudflare Account ID (optional):', {
        type: 'text',
      }))

    return CloudflareProvider.fromConfig({
      apiToken: apiTokenInput as string,
      zoneId: zoneIdInput as string,
      accountId: (accountIdInput as string) || undefined,
    })
  }

  return CloudflareProvider.fromConfig({
    apiToken,
    zoneId,
    accountId,
  })
}

/**
 * Prompt user to select provider
 */
async function promptForProvider(): Promise<ProviderType> {
  logger.info(chalk.yellow('Unable to auto-detect firewall provider.'))
  logger.info('Please select a provider:\n')
  logger.info('  1. Vercel Firewall')
  logger.info('  2. Cloudflare WAF\n')

  const choice = await prompt('Select provider (1 or 2):', {
    type: 'text',
  })

  const choiceStr = String(choice).toLowerCase()
  if (choiceStr === '1' || choiceStr === 'vercel') {
    return 'vercel'
  } else if (choiceStr === '2' || choiceStr === 'cloudflare') {
    return 'cloudflare'
  } else {
    logger.warn(`Invalid choice: ${choice}, defaulting to Vercel`)
    return 'vercel'
  }
}

/**
 * Verify provider credentials are valid
 */
export async function verifyProviderCredentials(provider: IFirewallProvider): Promise<boolean> {
  try {
    logger.debug(`Verifying ${provider.name} credentials...`)
    const isValid = await provider.verifyCredentials()

    if (isValid) {
      logger.debug(`${provider.name} credentials verified successfully`)
      return true
    } else {
      logger.error(`${provider.name} credential verification failed`)
      return false
    }
  } catch (error) {
    logger.error(`Error verifying ${provider.name} credentials:`, error)
    return false
  }
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(providerType: ProviderType): string {
  switch (providerType) {
    case 'vercel':
      return 'Vercel Firewall'
    case 'cloudflare':
      return 'Cloudflare WAF'
    default:
      return providerType
  }
}
