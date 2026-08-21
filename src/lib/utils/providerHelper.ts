import chalk from 'chalk'
import { logger } from '../logger'
import { prompt } from '../ui/prompt'
import { promptSecret } from '../ui/promptSecret'
import { ProviderDetector } from '../providers/ProviderDetector'
import { VercelProvider } from '../providers/vercel'
import { CloudflareProvider } from '../providers/cloudflare'
import { FastlyProvider } from '../providers/fastly'
import { PROVIDER_TYPES, type IFirewallProvider, type ProviderType } from '../providers/IFirewallProvider'
import { resolveCredentials } from '../providers/credentials'
import { vercelCredentials } from '../providers/vercel/credentials'
import { cloudflareCredentials } from '../providers/cloudflare/credentials'
import { fastlyCredentials } from '../providers/fastly/credentials'
import type { FirewallConfig, UnifiedConfig } from '../types'

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

  // Fastly-specific (note: `apiToken` above is shared with Cloudflare's
  // flag — both mean "this provider's API token" and are resolved against
  // whichever provider is actually selected, same as Cloudflare/Vercel
  // never colliding today because only one provider is active per command)
  workspaceId?: string
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
  vercelCredentials?: { token: string; projectId: string; teamId?: string }
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
    } else if (providerType === 'fastly') {
      const provider = await getFastlyProvider(options)
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
  // Vercel credentials may live directly on the config (legacy `.doorman.json`
  // shape) or under `providers.vercel` (unified config shape). Both are
  // checked since a config's shape can't be reliably inferred from `rules`
  // alone (both legacy and unified configs have a top-level `rules` array).
  const config = options.config as (Partial<FirewallConfig> & Partial<UnifiedConfig>) | undefined

  // Resolution order (explicit flag -> config -> env) comes from the shared
  // descriptor rather than being spelled out per credential here; the env
  // var names live with the Vercel adapter. Precedence is pinned by the
  // tests in providerHelper.test.ts.
  const { token, projectId, teamId } = resolveCredentials(vercelCredentials, {
    explicit: { token: options.token, projectId: options.projectId, teamId: options.teamId },
    config: {
      projectId: config?.providers?.vercel?.projectId ?? config?.projectId,
      teamId: config?.providers?.vercel?.teamId ?? config?.teamId,
    },
  })

  // teamId is deliberately excluded from this completeness check — omitting
  // it just means "use my Vercel default team" (every account has one), so
  // its absence alone must never block a user or force a re-prompt (see
  // issue #207).
  if (!token || !projectId) {
    if (options.interactive === false) {
      throw new Error('Vercel credentials missing. Provide token and projectId.')
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
  const config = options.config as Partial<UnifiedConfig> | undefined

  const { apiToken, zoneId, accountId } = resolveCredentials(cloudflareCredentials, {
    explicit: { apiToken: options.apiToken, zoneId: options.zoneId, accountId: options.accountId },
    config: {
      zoneId: config?.providers?.cloudflare?.zoneId,
      accountId: config?.providers?.cloudflare?.accountId,
    },
  })

  if (!apiToken || !zoneId) {
    if (options.interactive === false) {
      throw new Error('Cloudflare credentials missing. Provide apiToken and zoneId.')
    }

    logger.warn('Missing Cloudflare credentials')
    logger.info('Please provide your Cloudflare credentials:')

    const apiTokenInput = apiToken || (await promptSecret('Cloudflare API Token: '))

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
 * Get Fastly provider instance
 */
async function getFastlyProvider(options: ProviderOptions): Promise<IFirewallProvider> {
  const config = options.config as Partial<UnifiedConfig> | undefined

  const { apiToken, workspaceId } = resolveCredentials(fastlyCredentials, {
    explicit: { apiToken: options.apiToken, workspaceId: options.workspaceId },
    config: {
      workspaceId: config?.providers?.fastly?.workspaceId,
    },
  })

  if (!apiToken || !workspaceId) {
    if (options.interactive === false) {
      throw new Error('Fastly credentials missing. Provide apiToken and workspaceId.')
    }

    logger.warn('Missing Fastly credentials')
    logger.info('Please provide your Fastly credentials:')

    const apiTokenInput = apiToken || (await promptSecret('Fastly API Token: '))
    const workspaceIdInput =
      workspaceId ||
      (await prompt('Fastly Next-Gen WAF Workspace ID:', {
        type: 'text',
      }))

    return FastlyProvider.fromConfig({
      apiToken: apiTokenInput as string,
      workspaceId: workspaceIdInput as string,
    })
  }

  return FastlyProvider.fromConfig({
    apiToken,
    workspaceId,
  })
}

/**
 * Prompt user to select provider
 */
async function promptForProvider(): Promise<ProviderType> {
  // Enumerated from PROVIDER_TYPES rather than hardcoded, so a new provider
  // shows up in the picker automatically instead of needing this menu (and
  // its numeric mapping, and its range prompt) edited by hand.
  logger.info(chalk.yellow('Unable to auto-detect firewall provider.'))
  logger.info('Please select a provider:\n')
  PROVIDER_TYPES.forEach((type, index) => {
    logger.info(`  ${index + 1}. ${getProviderDisplayName(type)}`)
  })
  logger.info('')

  const choice = await prompt(`Select provider (1-${PROVIDER_TYPES.length}):`, {
    type: 'text',
  })

  const choiceStr = String(choice).trim().toLowerCase()

  const byName = PROVIDER_TYPES.find((type) => type === choiceStr)
  if (byName) {
    return byName
  }

  const index = Number(choiceStr)
  if (Number.isInteger(index) && index >= 1 && index <= PROVIDER_TYPES.length) {
    return PROVIDER_TYPES[index - 1]!
  }

  const fallback = PROVIDER_TYPES[0]!
  logger.warn(`Invalid choice: ${choice}, defaulting to ${getProviderDisplayName(fallback)}`)
  return fallback
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
    case 'fastly':
      return 'Fastly Next-Gen WAF'
    default:
      return providerType
  }
}
