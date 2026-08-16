import chalk from 'chalk'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import type { UnifiedConfig } from '../lib/types/unified'
import { ConfigHealthChecker } from '../lib/utils/configHealth'
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
    async ({ config, service, provider }) => {
      if (provider.name !== 'vercel') {
        await statusWithProvider(provider, config as unknown as UnifiedConfig)
        return
      }

      logger.start('Checking sync status...')

      const { toAdd, toUpdate, toDelete, ipsToAdd, ipsToUpdate, ipsToDelete, version } =
        await service.getChanges(config)

      const hasCustomRuleChanges = toAdd.length > 0 || toUpdate.length > 0 || toDelete.length > 0
      const hasIPRuleChanges = ipsToAdd.length > 0 || ipsToUpdate.length > 0 || ipsToDelete.length > 0
      const hasVersionChange = config.version !== version

      logger.log(chalk.bold('\n📊 Sync Status Summary\n'))

      logger.log(`${chalk.dim('Local Version:')} ${chalk.yellow(config.version || 'unknown')}`)
      logger.log(`${chalk.dim('Remote Version:')} ${chalk.yellow(version)}`)

      if (hasVersionChange) {
        logger.log(`${chalk.dim('Version Status:')} ${chalk.red('Out of sync')}`)
      } else {
        logger.log(`${chalk.dim('Version Status:')} ${chalk.green('In sync')}`)
      }

      logger.log('')

      logger.log(`${chalk.dim('Custom Rules:')}`)
      logger.log(`  ${chalk.green('+')} ${toAdd.length} to add`)
      logger.log(`  ${chalk.cyan('~')} ${toUpdate.length} to update`)
      logger.log(`  ${chalk.red('-')} ${toDelete.length} to delete`)

      logger.log(`${chalk.dim('IP Blocking Rules:')}`)
      logger.log(`  ${chalk.green('+')} ${ipsToAdd.length} to add`)
      logger.log(`  ${chalk.cyan('~')} ${ipsToUpdate.length} to update`)
      logger.log(`  ${chalk.red('-')} ${ipsToDelete.length} to delete`)

      logger.log('')

      if (!hasCustomRuleChanges && !hasIPRuleChanges && !hasVersionChange) {
        logger.success(chalk.green('✅ Everything is in sync!'))
      } else {
        logger.warn(chalk.yellow('⚠️  Changes detected. Run `sync` to apply changes.'))

        if (hasVersionChange) {
          logger.info(chalk.dim('💡 Version mismatch detected - this will be updated during sync'))
        }
      }

      if (config.updatedAt) {
        logger.log(`\n${chalk.dim('Last Updated:')} ${new Date(config.updatedAt).toLocaleString()}`)
      }

      logger.log('\n' + chalk.bold('🏥 Configuration Health Check'))
      const healthResult = ConfigHealthChecker.check(config)
      const healthReport = ConfigHealthChecker.formatHealthReport(healthResult)
      logger.log(healthReport)
    },
  )
}

async function statusWithProvider(provider: IFirewallProvider, config: UnifiedConfig): Promise<void> {
  logger.start('Checking sync status...')
  const changes = await provider.getChanges(config)

  logger.log(chalk.bold(`\n📊 ${provider.name} Sync Status Summary\n`))
  logger.log(`${chalk.dim('Rules:')}`)
  logger.log(`  ${chalk.green('+')} ${changes.rulesToAdd.length} to add`)
  logger.log(`  ${chalk.cyan('~')} ${changes.rulesToUpdate.length} to update`)
  logger.log(`  ${chalk.red('-')} ${changes.rulesToDelete.length} to delete`)
  logger.log(`${chalk.dim('IPs:')}`)
  logger.log(`  ${chalk.green('+')} ${changes.ipsToAdd?.length ?? 0} to add`)
  logger.log(`  ${chalk.cyan('~')} ${changes.ipsToUpdate?.length ?? 0} to update`)
  logger.log(`  ${chalk.red('-')} ${changes.ipsToDelete?.length ?? 0} to delete`)
  logger.log('')

  if (!changes.hasChanges) {
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
