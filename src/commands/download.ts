import chalk from 'chalk'
import { Arguments } from 'yargs'
import { z } from 'zod'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import { configVersionSchema } from '../lib/schemas/firewallSchemas'
import { FirewallConfig } from '../lib/types'
import { prompt } from '../lib/ui/prompt'
import { saveConfig } from '../lib/utils/config'
import { fromUnifiedConfig } from '../lib/utils/vercelConfigAdapter'
import type { ProviderType } from '../lib/providers/IFirewallProvider'
import { providerOption } from '../lib/utils/providerOption'
import { withCredentials } from '../lib/utils/withCredentials'

interface DownloadOptions {
  config?: string
  provider?: ProviderType | 'cloudflare'
  projectId?: string
  teamId?: string
  token?: string
  apiToken?: string
  zoneId?: string
  accountId?: string
  workspaceId?: string
  dryRun?: boolean
  debug?: boolean
  configVersion?: number
  ci?: boolean
}

export const command = 'download [configVersion]'
export const desc =
  'Download remote Vercel Firewall rules and update local config, optionally for a specific configuration version'

export const builder = {
  configVersion: {
    type: 'number',
    description: 'Specific configuration version to download (defaults to latest)',
  },
  config: {
    alias: 'c',
    type: 'string',
    description: 'Path to firewall config file (defaults to .doorman.json)',
  },
  provider: providerOption,
  projectId: {
    alias: 'p',
    type: 'string',
    description: 'Vercel Project ID (can be set in config file)',
  },
  teamId: {
    alias: 't',
    type: 'string',
    description: 'Vercel Team ID (can be set in config file)',
  },
  token: {
    type: 'string',
    description: 'Vercel API token (defaults to VERCEL_TOKEN env var)',
  },
  apiToken: { type: 'string', description: 'Cloudflare API token (defaults to CLOUDFLARE_API_TOKEN env var)' },
  zoneId: { type: 'string', description: 'Cloudflare Zone ID (defaults to CLOUDFLARE_ZONE_ID env var)' },
  accountId: { type: 'string', description: 'Cloudflare Account ID (optional)' },
  workspaceId: {
    type: 'string',
    description: 'Fastly Next-Gen WAF Workspace ID (defaults to FASTLY_WORKSPACE_ID env var)',
  },
  dryRun: {
    alias: 'd',
    type: 'boolean',
    description: 'Show rules that would be downloaded without making changes',
    default: false,
  },
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

export const handler = async (argv: Arguments<DownloadOptions>) => {
  await withCredentials(
    {
      config: argv.config,
      provider: argv.provider,
      projectId: argv.projectId,
      teamId: argv.teamId,
      token: argv.token,
      apiToken: argv.apiToken,
      zoneId: argv.zoneId,
      accountId: argv.accountId,
      workspaceId: argv.workspaceId,
      debug: argv.debug,
      ci: argv.ci,
      optionalConfig: true,
      skipValidation: true,
      errorContext: 'downloading firewall rules',
    },
    async ({ config: existingConfig, provider }) => {
      // Validate version if provided
      if (argv.configVersion !== undefined) {
        try {
          configVersionSchema.parse(argv.configVersion)
        } catch (error) {
          if (error instanceof z.ZodError) {
            logger.error('Invalid configuration version number. Version must be a positive integer.')
            process.exit(1)
          }
          throw error
        }
      }

      await downloadWithProvider(provider, existingConfig, argv)
    },
  )
}

/**
 * Download via the generic IFirewallProvider interface. Rules/IPs are listed as
 * plain text rather than through the shared table renderers, which assume the
 * Vercel-specific rule shape (conditionGroup/action.mitigate).
 *
 * The fetched `UnifiedConfig` is written back through `fromUnifiedConfig`,
 * which converts it into whatever format `existingConfig` was already in
 * (legacy or unified) — a naive `{ ...existingConfig, ...remoteConfig }`
 * spread would corrupt a legacy config (unified `version: "2.0"` format
 * string overwriting the real numeric Vercel version, unified-shaped rules
 * replacing the legacy `conditionGroup`/`action.mitigate` shape, and
 * `projectId`/`teamId` dropped since they live nested under
 * `providers.vercel` on the unified side).
 */
async function downloadWithProvider(
  provider: IFirewallProvider,
  existingConfig: FirewallConfig,
  argv: Arguments<DownloadOptions>,
): Promise<void> {
  logger.start(
    `Fetching remote firewall configuration${argv.configVersion ? ` version ${argv.configVersion}` : ''} ...`,
  )
  const remoteConfig = await provider.fetchConfig(argv.configVersion)
  const rules = remoteConfig.rules
  const ips = remoteConfig.ips ?? []

  if (rules.length > 0) {
    logger.log(chalk.bold(`\nRemote Custom Rules to Download (${rules.length}):\n`))
    rules.forEach((rule) => logger.log(`  - ${rule.name}${rule.enabled ? '' : chalk.dim(' (disabled)')}`))
  } else {
    logger.info('No custom rules to download...')
  }

  if (ips.length > 0) {
    logger.log(chalk.bold(`\nRemote IP Blocking Rules to Download (${ips.length}):\n`))
    ips.forEach((ip) => logger.log(`  - ${ip.ip} (${ip.action})`))
  } else {
    logger.info('No IP blocking rules to download...')
  }

  if (argv.dryRun) {
    logger.info(chalk.cyan('Dry run completed. No changes made.'))
    return
  }

  const confirmed = await prompt(
    `Do you want to download${argv.configVersion ? ` version ${argv.configVersion}` : ' the latest version'} of these rules? This will overwrite your local configuration.`,
    { type: 'confirm' },
  )
  if (!confirmed) {
    logger.info(chalk.yellow('Download cancelled.'))
    return
  }

  const newConfig = fromUnifiedConfig(remoteConfig, existingConfig)

  logger.start('Saving configuration...')
  await saveConfig(newConfig as FirewallConfig, argv.config)
  logger.success(chalk.green('Successfully downloaded and updated configuration'))
}
