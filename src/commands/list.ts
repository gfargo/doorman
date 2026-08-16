import chalk from 'chalk'
import { Arguments } from 'yargs'
import { z } from 'zod'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import { configVersionSchema } from '../lib/schemas/firewallSchemas'
import { IPBlockingRule } from '../lib/types'
import { displayIPBlockingTable, displayRulesTable } from '../lib/ui/table'
import { withCredentials } from '../lib/utils/withCredentials'

interface ListOptions {
  provider?: 'vercel' | 'cloudflare'
  projectId: string
  teamId: string
  token?: string
  apiToken?: string
  zoneId?: string
  accountId?: string
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
  provider: { type: 'string', choices: ['vercel', 'cloudflare'], description: 'Firewall provider (auto-detected)' },
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
      debug: argv.debug,
      ci: argv.ci,
      optionalConfig: true,
      skipValidation: true,
      errorContext: 'listing firewall rules',
    },
    async ({ client, provider, token, projectId, teamId }) => {
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

      if (provider.name !== 'vercel') {
        await listWithProvider(provider, argv)
        return
      }

      logger.start(`Fetching firewall configuration${argv.configVersion ? ` version ${argv.configVersion}` : ''} ...`)
      logger.verbose(`Token: ${token}\t projectId: ${projectId}\t teamId: ${teamId}`)

      const liveConfig = await client.fetchFirewallConfig(argv.configVersion)

      const configRules = liveConfig.rules
      const ipBlockingRules = liveConfig.ips as IPBlockingRule[]

      const lastUpdated = new Date(liveConfig.updatedAt)
      const formattedDate = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(lastUpdated)

      logger.info(
        `Found ${chalk.cyan(configRules.length)} custom rules and ${chalk.cyan(ipBlockingRules.length)} IP blocking rules\n` +
          chalk.dim(`Version: ${chalk.yellow(liveConfig.version)} • Last Updated: ${chalk.yellow(formattedDate)}`),
      )

      if (argv.format === 'json') {
        logger.info(
          JSON.stringify(
            {
              version: liveConfig.version,
              updatedAt: liveConfig.updatedAt,
              lastUpdated: formattedDate,
              rules: configRules,
              ips: ipBlockingRules,
            },
            null,
            2,
          ),
        )
      } else {
        if (configRules.length === 0 && ipBlockingRules.length === 0) {
          logger.info(chalk.yellow('No rules found'))
          return
        }

        if (configRules.length > 0) {
          logger.log(chalk.bold.underline('\nCustom Rules:'), '\n')
          displayRulesTable(configRules, { showStatus: false })
        } else {
          logger.info(chalk.cyan('No custom rules found'))
        }

        if (ipBlockingRules.length > 0) {
          logger.log(chalk.bold.underline('\nIP Blocking Rules:'), '\n')
          displayIPBlockingTable(ipBlockingRules, { showStatus: false })
        } else {
          logger.info(chalk.cyan('No IP blocking rules found'))
        }
      }
    },
  )
}

/**
 * List via the generic IFirewallProvider interface. Rules/IPs are listed as plain
 * text for the table format rather than through the shared table renderers, which
 * assume the Vercel-specific rule shape (conditionGroup/action.mitigate).
 */
async function listWithProvider(provider: IFirewallProvider, argv: Arguments<ListOptions>): Promise<void> {
  logger.start(`Fetching firewall configuration${argv.configVersion ? ` version ${argv.configVersion}` : ''} ...`)

  const liveConfig = await provider.fetchConfig(argv.configVersion)
  const rules = liveConfig.rules
  const ips = liveConfig.ips ?? []
  const version = liveConfig.metadata?.version ?? liveConfig.version
  const updatedAt = liveConfig.metadata?.updatedAt

  logger.info(
    `Found ${chalk.cyan(rules.length)} custom rules and ${chalk.cyan(ips.length)} IP blocking rules\n` +
      chalk.dim(
        `Version: ${chalk.yellow(version ?? 'unknown')}${updatedAt ? ` • Last Updated: ${chalk.yellow(updatedAt)}` : ''}`,
      ),
  )

  if (argv.format === 'json') {
    logger.info(JSON.stringify({ version, updatedAt, rules, ips }, null, 2))
    return
  }

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
