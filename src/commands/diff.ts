import chalk from 'chalk'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import type { UnifiedConfig } from '../lib/types/unified'
import { toUnifiedConfig } from '../lib/utils/vercelConfigAdapter'
import { providerOption } from '../lib/utils/providerOption'
import { withCredentials } from '../lib/utils/withCredentials'
import { credentialOptions, pickCredentialOptions, type CredentialOptions } from '../lib/utils/credentialOptions'

interface DiffOptions extends CredentialOptions {
  config?: string
  debug?: boolean
  format?: 'table' | 'json'
  ci?: boolean
}

export const command = 'diff'
export const desc = 'Show detailed differences between local and remote firewall configuration'

export const builder = {
  config: { alias: 'c', type: 'string', description: 'Path to firewall config file' },
  provider: providerOption,
  ...credentialOptions,
  format: { alias: 'f', type: 'string', choices: ['table', 'json'], description: 'Output format', default: 'table' },
  debug: { type: 'boolean', description: 'Enable debug logging', default: false },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

export const handler = async (argv: Arguments<DiffOptions>) => {
  await withCredentials(
    {
      config: argv.config,
      provider: argv.provider,
      ...pickCredentialOptions(argv),
      debug: argv.debug,
      ci: argv.ci,
      errorContext: 'calculating diff',
    },
    async ({ config, provider }) => {
      await diffWithProvider(provider, toUnifiedConfig(config), argv)
    },
  )
}

async function diffWithProvider(
  provider: IFirewallProvider,
  config: UnifiedConfig,
  argv: Arguments<DiffOptions>,
): Promise<void> {
  const isJson = argv.format === 'json'

  if (!isJson) {
    logger.start('Calculating differences...')
  }
  const changes = await provider.getChanges(config)

  const ipsToAdd = changes.ipsToAdd ?? []
  const ipsToUpdate = changes.ipsToUpdate ?? []
  const ipsToDelete = changes.ipsToDelete ?? []

  // Checked before the no-changes early return below — an in-sync config is
  // a valid, common result, and `--format json` must produce parseable JSON
  // for it too, not silently fall back to a human sentence. See #209.
  if (isJson) {
    logger.log(
      JSON.stringify(
        {
          rules: {
            toAdd: changes.rulesToAdd,
            toUpdate: changes.rulesToUpdate,
            toDelete: changes.rulesToDelete,
          },
          ips: { toAdd: ipsToAdd, toUpdate: ipsToUpdate, toDelete: ipsToDelete },
          summary: {
            hasChanges: changes.hasChanges,
            ruleChanges: changes.rulesToAdd.length + changes.rulesToUpdate.length + changes.rulesToDelete.length,
            ipChanges: ipsToAdd.length + ipsToUpdate.length + ipsToDelete.length,
          },
        },
        null,
        2,
      ),
    )
    return
  }

  if (!changes.hasChanges) {
    logger.success(chalk.green('No differences found. Local and remote configurations are in sync.'))
    return
  }

  logger.log(chalk.bold(`\n🔍 ${provider.name} Configuration Differences\n`))

  logger.log(chalk.bold('Rule Changes:'))
  logger.log(`  ${chalk.green('+')} ${changes.rulesToAdd.length} to add`)
  changes.rulesToAdd.forEach((r) => logger.log(`    ${chalk.green('+')} ${r.name}`))
  logger.log(`  ${chalk.cyan('~')} ${changes.rulesToUpdate.length} to update`)
  changes.rulesToUpdate.forEach((r) => logger.log(`    ${chalk.cyan('~')} ${r.name}`))
  logger.log(`  ${chalk.red('-')} ${changes.rulesToDelete.length} to delete`)
  changes.rulesToDelete.forEach((r) => logger.log(`    ${chalk.red('-')} ${r.name}`))

  if (ipsToAdd.length || ipsToUpdate.length || ipsToDelete.length) {
    logger.log('')
    logger.log(chalk.bold('IP Rule Changes:'))
    logger.log(`  ${chalk.green('+')} ${ipsToAdd.length} to add`)
    logger.log(`  ${chalk.cyan('~')} ${ipsToUpdate.length} to update`)
    logger.log(`  ${chalk.red('-')} ${ipsToDelete.length} to delete`)
  }

  const totalChanges =
    changes.rulesToAdd.length +
    changes.rulesToUpdate.length +
    changes.rulesToDelete.length +
    ipsToAdd.length +
    ipsToUpdate.length +
    ipsToDelete.length
  logger.log('')
  logger.log(chalk.bold(`Summary: ${totalChanges} total changes detected`))
  logger.log(chalk.dim('Run `sync` to apply these changes to the remote configuration.'))
}
