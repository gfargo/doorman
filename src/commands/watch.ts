import chalk from 'chalk'
import { Stats, watchFile, unwatchFile } from 'fs'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import type { IFirewallProvider } from '../lib/providers/IFirewallProvider'
import type { FirewallConfig } from '../lib/types'
import { getConfig, saveConfig } from '../lib/utils/config'
import { applySyncResultToConfig, toUnifiedConfig } from '../lib/utils/vercelConfigAdapter'
import type { ProviderType } from '../lib/providers/IFirewallProvider'
import { providerOption } from '../lib/utils/providerOption'
import { withCredentials } from '../lib/utils/withCredentials'

interface WatchOptions {
  config?: string
  provider?: ProviderType | 'cloudflare'
  projectId?: string
  teamId?: string
  token?: string
  apiToken?: string
  zoneId?: string
  accountId?: string
  workspaceId?: string
  interval?: number
  debug?: boolean
  ci?: boolean
}

export const command = 'watch'
export const desc = 'Watch config file for changes and auto-sync'

export const builder = {
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
  interval: {
    alias: 'i',
    type: 'number',
    description: 'Watch interval in milliseconds',
    default: 1000,
  },
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

export const handler = async (argv: Arguments<WatchOptions>) => {
  const configPath = argv.config || '.doorman.json'

  await withCredentials(
    {
      config: configPath,
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
      errorContext: 'setting up watch mode',
    },
    async ({ provider }) => {
      let isProcessing = false
      let lastModified = 0

      logger.success(chalk.green(`👀 Watching ${configPath} for changes...`))
      logger.log(chalk.dim('Press Ctrl+C to stop watching'))
      logger.log('')

      const handleFileChange = async (curr: Stats, _prev: Stats) => {
        if (isProcessing || curr.mtime.getTime() === lastModified) {
          return
        }

        isProcessing = true
        lastModified = curr.mtime.getTime()

        try {
          logger.log(chalk.yellow(`📝 Config file changed at ${new Date().toLocaleTimeString()}`))
          logger.start('Validating and syncing changes...')

          const updatedConfig = await getConfig(configPath)
          await syncChangesWithProvider(provider, updatedConfig, configPath)

          logger.log(chalk.dim('Watching for more changes...'))
        } catch (error) {
          logger.error(chalk.red(`❌ Sync failed: ${error instanceof Error ? error.message : String(error)}`))
          logger.log(chalk.dim('Continuing to watch for changes...'))
        } finally {
          isProcessing = false
        }
      }

      watchFile(configPath, { interval: argv.interval }, handleFileChange)

      const cleanup = () => {
        logger.log('\n')
        logger.info(chalk.yellow('Stopping watch mode...'))
        unwatchFile(configPath)
        process.exit(0)
      }

      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)

      const keepAlive = () => {
        setTimeout(keepAlive, 1000)
      }
      keepAlive()
    },
  )
}

/**
 * Syncs a changed config file to the provider via the generic
 * IFirewallProvider interface — the same path for every provider (Vercel
 * included; a legacy-shaped local config is converted in-memory via
 * `toUnifiedConfig`). Always applies changes without prompting (force:
 * true), since watch mode is opt-in unattended auto-sync. `allowDeletions:
 * true` is likewise deliberate here (unlike plain `doorman sync --ci`): a
 * `watch` session is opted into by an actively-present developer editing the
 * local config file, not a headless CI job, so a deletion driven by their
 * own edit is exactly what they asked for.
 *
 * After a successful sync, provider-assigned rule ID changes and version/
 * metadata drift are written back to the local config file unconditionally
 * (no prompt, matching watch mode's unattended design).
 */
async function syncChangesWithProvider(
  provider: IFirewallProvider,
  originalConfig: FirewallConfig,
  configPath: string,
): Promise<void> {
  const updatedConfig = toUnifiedConfig(originalConfig)
  const changes = await provider.getChanges(updatedConfig)

  const localVersion = updatedConfig.metadata?.version
  const hasVersionChange = changes.version !== undefined && localVersion !== changes.version

  if (!changes.hasChanges && !hasVersionChange) {
    logger.info(chalk.blue('No changes detected, skipping sync'))
    return
  }

  const totalChanges =
    changes.rulesToAdd.length +
    changes.rulesToUpdate.length +
    changes.rulesToDelete.length +
    (changes.ipsToAdd?.length ?? 0) +
    (changes.ipsToUpdate?.length ?? 0) +
    (changes.ipsToDelete?.length ?? 0)
  logger.log(chalk.cyan(`Syncing ${totalChanges} changes...`))

  const result = await provider.syncRules(updatedConfig, { force: true, allowDeletions: true })

  if (!result.success) {
    throw new Error(`Sync failed: ${result.errors?.join(', ') || 'unknown error'}`)
  }

  logger.success(chalk.green(`✅ Sync completed at ${new Date().toLocaleTimeString()}`))
  result.warnings?.forEach((w) => logger.warn(w))

  if (result.idRemappings?.length) {
    result.idRemappings.forEach((r) => {
      logger.info(chalk.dim(`  Rule "${r.name}" ID updated: ${r.oldId || 'none'} -> ${r.newId}`))
    })
  }

  const writeBack = applySyncResultToConfig(originalConfig, result)
  if (writeBack.changed) {
    await saveConfig(writeBack.config, configPath)
  }
}
