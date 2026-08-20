import chalk from 'chalk'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import type { UnifiedConfig } from '../lib/types/unified'
import { toUnifiedConfig } from '../lib/utils/vercelConfigAdapter'
import { withCredentials } from '../lib/utils/withCredentials'

interface StatusOptions {
  config?: string
  provider?: 'vercel' | 'cloudflare'
  projectId?: string
  teamId?: string
  token?: string
  apiToken?: string
  zoneId?: string
  accountId?: string
  debug?: boolean
  ci?: boolean
}

export const command = 'status'
export const desc = 'Show sync status between local and remote firewall configuration'

export const builder = {
  config: {
    alias: 'c',
    type: 'string',
    description: 'Path to firewall config file (defaults to .doorman.json)',
  },
  provider: { type: 'string', choices: ['vercel', 'cloudflare'], description: 'Firewall provider (auto-detected)' },
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
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

export const handler = async (argv: Arguments<StatusOptions>) => {
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
      debug: argv.debug,
      ci: argv.ci,
      errorContext: 'checking status',
    },
    async ({ config, provider }) => {
      await statusWithProvider(provider, toUnifiedConfig(config))
    },
  )
}

async function statusWithProvider(provider: IFirewallProvider, config: UnifiedConfig): Promise<void> {
  logger.start('Checking sync status...')
  const changes = await provider.getChanges(config)

  const localVersion = config.metadata?.version
  // Only flag a mismatch when a local version was actually tracked before —
  // a brand-new/never-synced config has no `metadata.version` yet, and that
  // absence isn't itself a drift signal.
  const hasVersionChange =
    changes.version !== undefined && localVersion !== undefined && localVersion !== changes.version

  logger.log(chalk.bold(`\n📊 ${provider.name} Sync Status Summary\n`))

  if (changes.version !== undefined) {
    logger.log(`${chalk.dim('Local Version:')} ${chalk.yellow(localVersion ?? 'unknown')}`)
    logger.log(`${chalk.dim('Remote Version:')} ${chalk.yellow(changes.version)}`)
    logger.log(
      `${chalk.dim('Version Status:')} ${hasVersionChange ? chalk.red('Out of sync') : chalk.green('In sync')}`,
    )
    logger.log('')
  }

  logger.log(`${chalk.dim('Rules:')}`)
  logger.log(`  ${chalk.green('+')} ${changes.rulesToAdd.length} to add`)
  logger.log(`  ${chalk.cyan('~')} ${changes.rulesToUpdate.length} to update`)
  logger.log(`  ${chalk.red('-')} ${changes.rulesToDelete.length} to delete`)
  logger.log(`${chalk.dim('IPs:')}`)
  logger.log(`  ${chalk.green('+')} ${changes.ipsToAdd?.length ?? 0} to add`)
  logger.log(`  ${chalk.cyan('~')} ${changes.ipsToUpdate?.length ?? 0} to update`)
  logger.log(`  ${chalk.red('-')} ${changes.ipsToDelete?.length ?? 0} to delete`)
  logger.log('')

  if (!changes.hasChanges && !hasVersionChange) {
    logger.success(chalk.green('✅ Everything is in sync!'))
  } else {
    logger.warn(chalk.yellow('⚠️  Changes detected. Run `sync` to apply changes.'))
  }

  logger.log('\n' + chalk.bold('🏥 Configuration Health Check'))
  const health = provider.getHealthScore(config)
  logger.log(`${chalk.dim('Score:')} ${health.score}/100 (${health.grade})`)
  health.issues.forEach((issue) => {
    const marker =
      issue.severity === 'error' ? chalk.red('✗') : issue.severity === 'warning' ? chalk.yellow('⚠') : chalk.dim('ℹ')
    logger.log(`  ${marker} [${issue.category}] ${issue.message}`)
    if (issue.suggestion) {
      logger.log(`    ${chalk.dim(issue.suggestion)}`)
    }
  })
  if (health.recommendations.length > 0) {
    logger.log(chalk.dim('\nRecommendations:'))
    health.recommendations.forEach((rec) => logger.log(`  - ${rec}`))
  }
}
