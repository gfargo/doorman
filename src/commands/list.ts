import chalk from 'chalk'
import { Arguments } from 'yargs'
import { z } from 'zod'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import { configVersionSchema } from '../lib/schemas/firewallSchemas'
import type { ProviderType } from '../lib/providers/IFirewallProvider'
import { providerOption } from '../lib/utils/providerOption'
import { withCredentials } from '../lib/utils/withCredentials'

interface ListOptions {
  provider?: ProviderType | 'cloudflare'
  projectId: string
  teamId: string
  token?: string
  apiToken?: string
  zoneId?: string
  accountId?: string
  workspaceId?: string
  format?: 'json' | 'table'
  debug: boolean
  configVersion?: number
  ci?: boolean
}

export const command = 'list [configVersion]'
export const desc = 'List Vercel Firewall rules, optionally for a specific configuration version'

export const builder = {
  configVersion: {
    type: 'number',
    description: 'Specific configuration version to fetch (defaults to latest)',
  },
  provider: providerOption,
  projectId: {
    alias: 'p',
    type: 'string',
    description: 'Vercel Project ID (can be set in config file or VERCEL_PROJECT_ID environment variable)',
  },
  teamId: {
    alias: 't',
    type: 'string',
    description: 'Vercel Team ID (can be set in config file or VERCEL_TEAM_ID environment variable)',
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
  format: {
    alias: 'f',
    type: 'string',
    description: 'Output format (json or table)',
    choices: ['json', 'table'],
    default: 'table',
  },
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

export const handler = async (argv: Arguments<ListOptions>) => {
  await withCredentials(
    {
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
      errorContext: 'listing firewall rules',
    },
    async ({ provider }) => {
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

      await listWithProvider(provider, argv)
    },
  )
}

/**
 * List via the generic IFirewallProvider interface. Rules/IPs are listed as plain
 * text for the table format rather than through the shared table renderers, which
 * assume the Vercel-specific rule shape (conditionGroup/action.mitigate).
 */
async function listWithProvider(provider: IFirewallProvider, argv: Arguments<ListOptions>): Promise<void> {
  const isJson = argv.format === 'json'

  // Progress/status lines are human-facing chrome, not part of the `json`
  // contract — `doorman list --format json | jq .` needs stdout to contain
  // nothing but the payload. Suppressed rather than moved to stderr to avoid
  // a second logger stream just for this; see #209.
  if (!isJson) {
    logger.start(`Fetching firewall configuration${argv.configVersion ? ` version ${argv.configVersion}` : ''} ...`)
  }

  const liveConfig = await provider.fetchConfig(argv.configVersion)
  const rules = liveConfig.rules
  const ips = liveConfig.ips ?? []
  const version = liveConfig.metadata?.version ?? liveConfig.version
  const updatedAt = liveConfig.metadata?.updatedAt

  if (isJson) {
    // logger.log (not logger.info) — info prepends consola's ℹ icon, which
    // would corrupt the payload the same way the suppressed lines above did.
    logger.log(JSON.stringify({ version, updatedAt, rules, ips }, null, 2))
    return
  }

  logger.info(
    `Found ${chalk.cyan(rules.length)} custom rules and ${chalk.cyan(ips.length)} IP blocking rules\n` +
      chalk.dim(
        `Version: ${chalk.yellow(version ?? 'unknown')}${updatedAt ? ` • Last Updated: ${chalk.yellow(updatedAt)}` : ''}`,
      ),
  )

  if (rules.length === 0 && ips.length === 0) {
    logger.info(chalk.yellow('No rules found'))
    return
  }

  if (rules.length > 0) {
    logger.log(chalk.bold.underline('\nCustom Rules:'), '\n')
    rules.forEach((rule) => logger.log(`  - ${rule.name}${rule.enabled ? '' : chalk.dim(' (disabled)')}`))
  } else {
    logger.info(chalk.cyan('No custom rules found'))
  }

  if (ips.length > 0) {
    logger.log(chalk.bold.underline('\nIP Blocking Rules:'), '\n')
    ips.forEach((ip) => logger.log(`  - ${ip.ip} (${ip.action})`))
  } else {
    logger.info(chalk.cyan('No IP blocking rules found'))
  }
}
