import chalk from 'chalk'
import { logger } from '../logger'
import { prompt } from '../ui/prompt'
import { promptSecret } from '../ui/promptSecret'
import { ProviderDetector } from '../providers/ProviderDetector'
import { VercelProvider } from '../providers/vercel'
import { CloudflareProvider } from '../providers/cloudflare'
import { FastlyProvider } from '../providers/fastly'
import { CloudArmorProvider } from '../providers/gcp'
import { PROVIDER_TYPES, type IFirewallProvider, type ProviderType } from '../providers/IFirewallProvider'
import { CREDENTIAL_DESCRIPTORS, missingRequiredCredentials, resolveCredentials } from '../providers/credentials'
import type { CredentialField } from '../providers/credentials'
import type { FirewallConfig, UnifiedConfig } from '../types'

export interface ProviderOptions {
  provider?: ProviderType
  config?: FirewallConfig | UnifiedConfig | Partial<FirewallConfig> | Partial<UnifiedConfig>
  interactive?: boolean
  /**
   * Explicit credential values (typically CLI flags), keyed by each field's
   * `key` from that provider's `CredentialDescriptor` — e.g. `token`,
   * `projectId`, `apiToken`, `zoneId`, `workspaceId`. A key belonging to a
   * provider other than the one actually resolved is simply never read; the
   * same `apiToken` key is shared by both Cloudflare and Fastly, resolved
   * against whichever provider is active, the same way it always has been.
   */
  credentials?: Record<string, string | undefined>
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

  // 2. Resolve credentials generically against the provider's descriptor,
  // then construct the concrete provider instance.
  try {
    const resolved = await resolveAndPromptCredentials(providerType, options)
    return buildProvider(providerType, resolved)
  } catch (error) {
    logger.error(`Failed to initialize ${providerType} provider:`, error)
    throw error
  }
}

/**
 * A field's value as declared in the config file, checking both the
 * multi-provider `providers.<name>.<configKey>` location and — only for
 * fields that declare one — the legacy top-level location predating that
 * shape (see `CredentialField.legacyConfigKey`).
 */
function extractConfigValue(
  config: (Partial<FirewallConfig> & Partial<UnifiedConfig>) | undefined,
  providerType: ProviderType,
  field: CredentialField,
): string | undefined {
  if (!field.configKey) return undefined

  const providersBlock = config?.providers as Record<string, Record<string, unknown>> | undefined
  const nested = providersBlock?.[providerType]?.[field.configKey]
  if (typeof nested === 'string') return nested

  if (field.legacyConfigKey) {
    const legacy = (config as Record<string, unknown> | undefined)?.[field.legacyConfigKey]
    if (typeof legacy === 'string') return legacy
  }

  return undefined
}

/**
 * Resolve a provider's credentials (explicit -> config -> env), prompting
 * interactively for whatever's still missing once a required field turns up
 * absent. The one generic implementation every provider goes through —
 * adding a provider means adding its `CredentialDescriptor`, not a new
 * branch here.
 */
async function resolveAndPromptCredentials(
  providerType: ProviderType,
  options: ProviderOptions,
): Promise<Record<string, string | undefined>> {
  const descriptor = CREDENTIAL_DESCRIPTORS[providerType]
  const config = options.config as (Partial<FirewallConfig> & Partial<UnifiedConfig>) | undefined

  const configValues: Record<string, string | undefined> = {}
  for (const field of descriptor.fields) {
    configValues[field.key] = extractConfigValue(config, providerType, field)
  }

  const resolved = resolveCredentials(descriptor, {
    explicit: options.credentials,
    config: configValues,
  })

  const missing = missingRequiredCredentials(descriptor, resolved)
  if (missing.length === 0) {
    return resolved
  }

  if (options.interactive === false) {
    const flags = missing.map((field) => `--${field.key}`).join(', ')
    throw new Error(`${getProviderDisplayName(providerType)} credentials missing. Provide ${flags}.`)
  }

  logger.warn(`Missing ${getProviderDisplayName(providerType)} credentials`)
  logger.info(`Please provide your ${getProviderDisplayName(providerType)} credentials:`)

  for (const field of descriptor.fields) {
    if (resolved[field.key]) continue
    const message = field.promptMessage ?? defaultPromptMessage(field)
    const answer = field.secret ? await promptSecret(message) : await prompt(message, { type: 'text' })
    resolved[field.key] = (answer as string) || undefined
  }

  return resolved
}

function defaultPromptMessage(field: CredentialField): string {
  const suffix = field.required ? '' : ' (optional)'
  // promptSecret writes its message straight to stdout ahead of masked
  // input on the same line, so it needs a trailing space; prompt() renders
  // its message as a styled label and doesn't.
  const trailingSpace = field.secret ? ' ' : ''
  return `${field.label}${suffix}:${trailingSpace}`
}

/**
 * Construct the concrete provider from its resolved credentials. The one
 * place that maps a generic bag onto each provider's distinctly-typed
 * `fromConfig` — an unavoidable boundary, since a `Record<string, string>`
 * isn't itself a valid argument to any of them.
 */
function buildProvider(
  providerType: ProviderType,
  resolved: Record<string, string | undefined>,
): ProviderInstanceResult {
  switch (providerType) {
    case 'vercel': {
      const credentials = { token: resolved.token!, projectId: resolved.projectId!, teamId: resolved.teamId }
      return { provider: VercelProvider.fromConfig(credentials), vercelCredentials: credentials }
    }
    case 'cloudflare':
      return {
        provider: CloudflareProvider.fromConfig({
          apiToken: resolved.apiToken!,
          zoneId: resolved.zoneId!,
          accountId: resolved.accountId,
        }),
      }
    case 'fastly':
      return {
        provider: FastlyProvider.fromConfig({ apiToken: resolved.apiToken!, workspaceId: resolved.workspaceId! }),
      }
    case 'gcp':
      return {
        provider: CloudArmorProvider.fromConfig({
          projectId: resolved.projectId!,
          policyName: resolved.policyName!,
          serviceAccountKeyPath: resolved.serviceAccountKeyPath,
        }),
      }
    default:
      throw new Error(`Unknown provider: ${providerType as string}`)
  }
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
    case 'gcp':
      return 'Google Cloud Armor'
    default:
      return providerType
  }
}
