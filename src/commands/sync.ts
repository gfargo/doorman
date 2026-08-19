import chalk from 'chalk'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import { CustomRule, FirewallConfig } from '../lib/types'
import type { UnifiedConfig } from '../lib/types/unified'
import { prompt } from '../lib/ui/prompt'
import { displayIPBlockingTable, displayRulesTable, RULE_STATUS_MAP } from '../lib/ui/table'
import { saveConfig } from '../lib/utils/config'
import { withCredentials } from '../lib/utils/withCredentials'

interface SyncOptions {
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
  allowDeletions?: boolean
}

export const command = 'sync'
export const desc = 'Sync Vercel Firewall rules with config file'

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
  allowDeletions: {
    type: 'boolean',
    description:
      'Required together with --ci to let a non-interactive sync delete existing rules/IPs. Without it, a --ci sync that would delete anything is refused rather than applied silently.',
    default: false,
  },
}

export const handler = async (argv: Arguments<SyncOptions>) => {
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
      errorContext: 'syncing firewall rules',
    },
    async (ctx) => {
      if (ctx.provider.name !== 'vercel') {
        await syncWithProvider(ctx.provider, ctx.config, argv)
        return
      }

      let config = ctx.config
      const service = ctx.service

      logger.start(chalk.magenta('Calculating firewall configuration changes...'))
      const { toAdd, toUpdate, toDelete, ipsToAdd, ipsToUpdate, ipsToDelete, version } =
        await service.getChanges(config)

      const hasCustomRuleChanges = toAdd.length > 0 || toUpdate.length > 0 || toDelete.length > 0
      const hasIPRuleChanges = ipsToAdd.length > 0 || ipsToUpdate.length > 0 || ipsToDelete.length > 0
      const hasVersionChange = config.version !== version

      if (!hasCustomRuleChanges && !hasIPRuleChanges && !hasVersionChange) {
        logger.success(chalk.green('No changes detected. Firewall rules are in sync.'))
        return
      }

      if (hasCustomRuleChanges) {
        logger.log(chalk.bold('\nProposed Custom Rule Changes:\n'))
        displayRulesTable(
          [
            ...toAdd.map((rule: any) => ({ ...rule, changeStatus: RULE_STATUS_MAP.new, id: rule.id as string })),
            ...toUpdate.map((rule) => ({ ...rule, changeStatus: RULE_STATUS_MAP.modified, id: rule.id as string })),
            ...toDelete.map((rule) => ({ ...rule, changeStatus: RULE_STATUS_MAP.deleted, id: rule.id as string })),
          ],
          { showStatus: true },
        )
      }

      if (hasIPRuleChanges) {
        logger.log(chalk.bold('\nProposed IP Blocking Rule Changes:\n'))
        displayIPBlockingTable(
          [
            ...ipsToAdd.map((rule) => ({ ...rule, changeStatus: RULE_STATUS_MAP.new, id: rule.id || undefined })),
            ...ipsToUpdate.map((rule) => ({
              ...rule,
              changeStatus: RULE_STATUS_MAP.modified,
              id: rule.id || undefined,
            })),
            ...ipsToDelete.map((rule) => ({
              ...rule,
              changeStatus: RULE_STATUS_MAP.deleted,
              id: rule.id || undefined,
            })),
          ],
          { showStatus: true },
        )
      }

      if (hasVersionChange) {
        logger.log(chalk.bold('\nProposed Metadata Changes:\n'))
        logger.log(`  - Version: ${chalk.red(config.version)} ${chalk.dim('->')} ${chalk.green(version)}`)
      }

      const confirmed = await prompt('Do you want to apply these changes?', { type: 'confirm' })
      if (!confirmed) {
        logger.info(chalk.yellow('Sync cancelled.'))
        return
      }

      logger.start('Starting firewall rules sync...')

      const backupConfig = JSON.parse(JSON.stringify(config)) as FirewallConfig

      const syncResult = await service.syncRules(config, {
        debug: argv.debug,
      })
      const { rulesToUpdateLocally } = syncResult
      logger.success(chalk.green('Firewall rules sync completed successfully'))

      try {
        const updatedConfig = await service.validateAndUpdateConfig(config, syncResult, { dryRun: false })
        config = updatedConfig
      } catch (error) {
        logger.error('Failed to validate sync result or update config metadata')
        logger.error(error instanceof Error ? error.message : String(error))

        await saveConfig(backupConfig, argv.config)

        logger.info(chalk.yellow('Restored original config due to validation failure'))
        throw new Error('Sync validation failed - original config restored')
      }

      // Filter rulesToUpdateLocally to only include entries whose oldId still
      // exists in the current config. validateAndUpdateConfig may have already
      // updated some rule IDs to match remote-assigned IDs.
      const pendingIdUpdates = rulesToUpdateLocally.filter((r) =>
        config.rules.some((rule) => r.oldId === rule.id || (r.oldId === '' && r.name === rule.name)),
      )

      if (pendingIdUpdates.length > 0) {
        logger.log('')
        logger.info(chalk.yellow('Some rules have IDs that do not match their expected snake_case name:'))
        pendingIdUpdates.forEach((rule) => {
          logger.log(
            `  - Rule "${rule.name}": ${chalk.red(rule.oldId || 'empty')} ${chalk.dim('->')} ${chalk.green(rule.newId)}`,
          )
        })

        const updateConfirmed = await prompt('Do you want to update the local config with the new IDs?', {
          type: 'confirm',
        })

        if (updateConfirmed) {
          config = {
            ...config,
            rules: config.rules.map((rule: CustomRule) => {
              const ruleToUpdate = pendingIdUpdates.find(
                (r) => r.oldId === rule.id || (r.oldId === '' && r.name === rule.name),
              )
              return ruleToUpdate ? { ...rule, id: ruleToUpdate.newId } : rule
            }),
            ips: config.ips || [],
          }

          await saveConfig(config, argv.config)
          logger.success(chalk.green('Updated local config with new rule IDs'))
        } else {
          logger.warn(chalk.yellow('Local config not updated. Remember to update rule IDs manually if needed.'))
        }
      }

      if (backupConfig.version !== config.version || backupConfig.updatedAt !== config.updatedAt) {
        await saveConfig(config, argv.config)
        logger.success(
          chalk.green(`Updated version ${chalk.dim(`(v${config.version})`)} and metadata in local config file`),
        )
      }
    },
  )
}

/**
 * Sync using the generic IFirewallProvider interface (Cloudflare and any future
 * non-Vercel provider). Simpler than the Vercel flow above: providers implementing
 * this interface handle their own diff/risk-assessment/confirmation internally, and
 * the interface has no equivalent of Vercel's remote-assigned-ID reconciliation, so
 * there's nothing to write back to the local config file after a successful sync.
 */
async function syncWithProvider(
  provider: IFirewallProvider,
  config: FirewallConfig,
  argv: Arguments<SyncOptions>,
): Promise<void> {
  const unifiedConfig = config as unknown as UnifiedConfig

  logger.start(chalk.magenta(`Calculating ${provider.name} firewall configuration changes...`))
  const changes = await provider.getChanges(unifiedConfig)

  if (!changes.hasChanges) {
    logger.success(chalk.green('No changes detected. Firewall rules are in sync.'))
    return
  }

  logger.log(chalk.bold('\nProposed Changes:\n'))
  logger.log(`  ${chalk.green('+')} ${changes.rulesToAdd.length} rules to add`)
  logger.log(`  ${chalk.cyan('~')} ${changes.rulesToUpdate.length} rules to update`)
  logger.log(`  ${chalk.red('-')} ${changes.rulesToDelete.length} rules to delete`)
  const ipsToAdd = changes.ipsToAdd ?? []
  const ipsToUpdate = changes.ipsToUpdate ?? []
  const ipsToDelete = changes.ipsToDelete ?? []
  if (ipsToAdd.length || ipsToUpdate.length || ipsToDelete.length) {
    logger.log(`  ${chalk.green('+')} ${ipsToAdd.length} IPs to add`)
    logger.log(`  ${chalk.cyan('~')} ${ipsToUpdate.length} IPs to update`)
    logger.log(`  ${chalk.red('-')} ${ipsToDelete.length} IPs to delete`)
  }

  logger.start('Starting firewall rules sync...')
  // Non-vercel providers prompt for confirmation internally (unless --ci); no need
  // to prompt again here. In --ci mode, a sync that would delete anything still
  // requires --allow-deletions — see OperationSafety.confirmDestructiveOperation.
  const result = await provider.syncRules(unifiedConfig, { force: argv.ci, allowDeletions: argv.allowDeletions })

  if (!result.success) {
    throw new Error(`Sync failed: ${result.errors?.join(', ') || 'unknown error'}`)
  }

  logger.success(chalk.green('Firewall rules sync completed successfully'))
  logger.log(`  Rules: ${result.rulesAdded} added, ${result.rulesUpdated} updated, ${result.rulesDeleted} deleted`)
  if (result.ipsAdded || result.ipsUpdated || result.ipsDeleted) {
    logger.log(
      `  IPs: ${result.ipsAdded ?? 0} added, ${result.ipsUpdated ?? 0} updated, ${result.ipsDeleted ?? 0} deleted`,
    )
  }
  result.warnings?.forEach((w) => logger.warn(w))
}
