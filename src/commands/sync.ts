import chalk from 'chalk'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import type { UnifiedIPRule, UnifiedRule } from '../lib/types/unified'
import { FirewallConfig } from '../lib/types'
import { saveConfig } from '../lib/utils/config'
import { applySyncResultToConfig, toUnifiedConfig } from '../lib/utils/vercelConfigAdapter'
import { providerOption } from '../lib/utils/providerOption'
import { withCredentials } from '../lib/utils/withCredentials'
import { credentialOptions, pickCredentialOptions, type CredentialOptions } from '../lib/utils/credentialOptions'

interface SyncOptions extends CredentialOptions {
  config?: string
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
  provider: providerOption,
  ...credentialOptions,
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
      ...pickCredentialOptions(argv),
      debug: argv.debug,
      ci: argv.ci,
      errorContext: 'syncing firewall rules',
    },
    async (ctx) => {
      await syncWithProvider(ctx.provider, ctx.config, argv)
    },
  )
}

/**
 * Sync using the generic IFirewallProvider interface — the same path for
 * every provider (Vercel included). A local legacy-shaped Vercel config is
 * converted to `UnifiedConfig` in-memory via `toUnifiedConfig` before being
 * handed to the provider; the file on disk is never rewritten into unified
 * format as a side effect of this.
 *
 * Providers implementing `IFirewallProvider` handle their own diff/risk-
 * assessment/confirmation internally (`syncRules` -> `OperationSafety`), so
 * there's a single confirmation UX across providers rather than Vercel
 * having its own separate prompt. After a successful sync, any
 * provider-assigned rule ID changes and version/metadata drift are written
 * back to the local config file in its original format (legacy or unified)
 * via `applySyncResultToConfig` — unconditionally, not behind a prompt: the
 * provider's returned ID is authoritative, so declining the write-back
 * would just leave the config permanently desynced.
 */
async function syncWithProvider(
  provider: IFirewallProvider,
  config: FirewallConfig,
  argv: Arguments<SyncOptions>,
): Promise<void> {
  const unifiedConfig = toUnifiedConfig(config)

  logger.start(chalk.magenta(`Calculating ${provider.name} firewall configuration changes...`))
  const changes = await provider.getChanges(unifiedConfig)

  const localVersion = unifiedConfig.metadata?.version
  const hasVersionChange = changes.version !== undefined && localVersion !== changes.version

  if (!changes.hasChanges && !hasVersionChange) {
    logger.success(chalk.green('No changes detected. Firewall rules are in sync.'))
    return
  }

  logger.log(chalk.bold('\nProposed Changes:\n'))
  logRuleNames('Rules to add', changes.rulesToAdd, chalk.green('+'))
  logRuleNames('Rules to update', changes.rulesToUpdate, chalk.cyan('~'))
  logRuleNames('Rules to delete', changes.rulesToDelete, chalk.red('-'))
  const ipsToAdd = changes.ipsToAdd ?? []
  const ipsToUpdate = changes.ipsToUpdate ?? []
  const ipsToDelete = changes.ipsToDelete ?? []
  if (ipsToAdd.length || ipsToUpdate.length || ipsToDelete.length) {
    logIPNames('IPs to add', ipsToAdd, chalk.green('+'))
    logIPNames('IPs to update', ipsToUpdate, chalk.cyan('~'))
    logIPNames('IPs to delete', ipsToDelete, chalk.red('-'))
  }
  if (hasVersionChange) {
    logger.log(
      `  Remote config version: ${chalk.red(localVersion ?? 'unknown')} ${chalk.dim('->')} ${chalk.green(changes.version)}`,
    )
  }

  logger.start('Starting firewall rules sync...')
  // Providers prompt for confirmation internally (unless --ci); no need to
  // prompt again here. In --ci mode, a sync that would delete anything still
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

  if (result.idRemappings?.length) {
    logger.info(chalk.yellow('Rule IDs were reassigned by the provider and written back to the local config:'))
    result.idRemappings.forEach((r) => {
      logger.log(`  - ${r.name}: ${chalk.red(r.oldId || 'none')} ${chalk.dim('->')} ${chalk.green(r.newId)}`)
    })
  }

  const writeBack = applySyncResultToConfig(config, result)
  if (writeBack.changed) {
    await saveConfig(writeBack.config, argv.config)
    logger.success(chalk.green('Updated local config with new version/metadata'))
  }
}

function logRuleNames(label: string, rules: UnifiedRule[], marker: string): void {
  if (rules.length === 0) return
  logger.log(`  ${marker} ${label} (${rules.length}):`)
  rules.forEach((rule) => logger.log(`      - ${rule.name}`))
}

function logIPNames(label: string, ips: UnifiedIPRule[], marker: string): void {
  if (ips.length === 0) return
  logger.log(`  ${marker} ${label} (${ips.length}):`)
  ips.forEach((ip) => logger.log(`      - ${ip.ip}${ip.hostname ? ` (${ip.hostname})` : ''}`))
}
