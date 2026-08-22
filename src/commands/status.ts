import chalk from 'chalk'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import type { UnifiedConfig } from '../lib/types/unified'
import { toUnifiedConfig } from '../lib/utils/vercelConfigAdapter'
import { providerOption } from '../lib/utils/providerOption'
import { withCredentials } from '../lib/utils/withCredentials'
import { credentialOptions, pickCredentialOptions, type CredentialOptions } from '../lib/utils/credentialOptions'

interface StatusOptions extends CredentialOptions {
  config?: string
  format?: 'table' | 'json'
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
  provider: providerOption,
  ...credentialOptions,
  format: { alias: 'f', type: 'string', choices: ['table', 'json'], description: 'Output format', default: 'table' },
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
      ...pickCredentialOptions(argv),
      debug: argv.debug,
      ci: argv.ci,
      errorContext: 'checking status',
    },
    async ({ config, provider }) => {
      await statusWithProvider(provider, toUnifiedConfig(config), argv)
    },
  )
}

async function statusWithProvider(
  provider: IFirewallProvider,
  config: UnifiedConfig,
  argv: Arguments<StatusOptions>,
): Promise<void> {
  const isJson = argv.format === 'json'

  if (!isJson) {
    logger.start('Checking sync status...')
  }
  const changes = await provider.getChanges(config)
  const health = provider.getHealthScore(config)

  const localVersion = config.metadata?.version
  // Only flag a mismatch when a local version was actually tracked before —
  // a brand-new/never-synced config has no `metadata.version` yet, and that
  // absence isn't itself a drift signal.
  const hasVersionChange =
    changes.version !== undefined && localVersion !== undefined && localVersion !== changes.version
  const inSync = !changes.hasChanges && !hasVersionChange

  if (isJson) {
    logger.log(
      JSON.stringify(
        {
          provider: provider.name,
          inSync,
          version: {
            local: localVersion ?? null,
            remote: changes.version ?? null,
            matches: changes.version !== undefined ? !hasVersionChange : null,
          },
          rules: {
            toAdd: changes.rulesToAdd.length,
            toUpdate: changes.rulesToUpdate.length,
            toDelete: changes.rulesToDelete.length,
          },
          ips: {
            toAdd: changes.ipsToAdd?.length ?? 0,
            toUpdate: changes.ipsToUpdate?.length ?? 0,
            toDelete: changes.ipsToDelete?.length ?? 0,
          },
          health,
        },
        null,
        2,
      ),
    )
    return
  }

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

  if (inSync) {
    logger.success(chalk.green('✅ Everything is in sync!'))
  } else {
    logger.warn(chalk.yellow('⚠️  Changes detected. Run `sync` to apply changes.'))
  }

  logger.log('\n' + chalk.bold('🏥 Configuration Health Check'))
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
