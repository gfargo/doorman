import chalk from 'chalk'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { LogLevels } from 'consola'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import { ValidationService } from '../lib/services/ValidationService'
import type { VercelConfig } from '../lib/services/VercelClient'
import { FirewallConfig } from '../lib/types'
import { prompt } from '../lib/ui/prompt'
import { getConfig, saveConfig } from '../lib/utils/config'
import { handleCommandError } from '../lib/utils/handleCommandError'
import { withCredentials } from '../lib/utils/withCredentials'

interface BackupOptions {
  config?: string
  provider?: 'vercel' | 'cloudflare'
  projectId?: string
  teamId?: string
  token?: string
  apiToken?: string
  zoneId?: string
  accountId?: string
  output?: string
  restore?: string
  list?: boolean
  debug?: boolean
  ci?: boolean
}

export const command = 'backup'
export const desc = 'Backup or restore firewall configurations'

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
  output: {
    alias: 'o',
    type: 'string',
    description: 'Output directory for backups',
    default: './backups',
  },
  restore: {
    alias: 'r',
    type: 'string',
    description: 'Restore from backup file',
  },
  list: {
    alias: 'l',
    type: 'boolean',
    description: 'List available backups',
    default: false,
  },
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

export const handler = async (argv: Arguments<BackupOptions>) => {
  try {
    if (argv.debug) {
      logger.level = LogLevels.debug
    }

    const backupDir = argv.output || './backups'

    // List backups — no credentials needed
    if (argv.list) {
      if (!existsSync(backupDir)) {
        logger.info(chalk.yellow('No backup directory found.'))
        return
      }

      const backups = readdirSync(backupDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
          const filePath = join(backupDir, file)
          const stats = statSync(filePath)
          return {
            name: file,
            size: stats.size,
            created: stats.mtime,
          }
        })
        .sort((a, b) => b.created.getTime() - a.created.getTime())

      if (backups.length === 0) {
        logger.info(chalk.yellow('No backups found.'))
        return
      }

      logger.log(chalk.bold('\n📦 Available Backups:\n'))
      backups.forEach((backup) => {
        logger.log(`${chalk.cyan(backup.name)}`)
        logger.log(`  ${chalk.dim('Created:')} ${backup.created.toLocaleString()}`)
        logger.log(`  ${chalk.dim('Size:')} ${(backup.size / 1024).toFixed(1)} KB`)
        logger.log('')
      })
      return
    }

    // Restore from backup — no credentials needed
    if (argv.restore) {
      const restorePath = argv.restore.startsWith('/') ? argv.restore : join(backupDir, argv.restore)

      if (!existsSync(restorePath)) {
        logger.error(`Backup file not found: ${restorePath}`)
        process.exit(1)
      }

      const backupConfig = await getConfig(restorePath, 'raw')
      const outputPath = argv.config || '.doorman.json'

      if (existsSync(outputPath)) {
        const overwrite = await prompt(`Config file ${outputPath} already exists. Do you want to overwrite it?`, {
          type: 'confirm',
        })

        if (!overwrite) {
          logger.info(chalk.yellow('Restore cancelled.'))
          return
        }
      }

      // Real backups carry a `backup: {createdAt, source, provider, ...}`
      // metadata field (added when the backup was created — see below) that
      // isn't part of the live config schema (additionalProperties: false).
      // Strip it before validating/saving, the same way backup creation keeps
      // it out of the validated sanitizedConfig.
      const { backup: _backupMetadata, ...restoredConfig } = backupConfig as FirewallConfig & { backup?: unknown }

      await saveConfig(restoredConfig as FirewallConfig, outputPath)
      logger.success(chalk.green(`✅ Restored configuration from ${restorePath} to ${outputPath}`))
      return
    }

    // Create backup — needs credentials
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
        errorContext: 'creating backup',
      },
      async ({ client, provider, projectId, teamId }) => {
        logger.start('Fetching current remote configuration...')
        const remoteConfig =
          provider.name === 'vercel' ? await client.fetchFirewallConfig() : await provider.fetchConfig()

        // The raw Vercel API response includes fields (id, crs, projectKey,
        // ownerId) that aren't part of a Doorman config and would fail schema
        // validation (additionalProperties: false) — strip them before
        // validating/saving, the same way download.ts builds its saved config.
        // The API also attaches valid/validationErrors to every rule object
        // (download.ts strips these too, for the same reason — CustomRule also
        // has additionalProperties: false). Cloudflare's fetchConfig() already
        // returns a clean UnifiedConfig with no extra fields, so it's used as-is.
        const sanitizedConfig =
          provider.name === 'vercel'
            ? {
                version: remoteConfig.version,
                firewallEnabled: (remoteConfig as VercelConfig).firewallEnabled,
                rules: remoteConfig.rules.map(({ valid, validationErrors, ...rule }: any) => rule),
                ips: remoteConfig.ips,
                updatedAt: (remoteConfig as VercelConfig).updatedAt,
              }
            : remoteConfig

        // Validate the sanitized config (before adding the backup metadata
        // wrapper below) — this catches genuine API response corruption rather
        // than trusting whatever the provider returned. It's validated here,
        // not after wrapping, because the wrapper's `backup` field isn't part of
        // the live config schema (additionalProperties: false); see the save
        // below for why that final write is unvalidated.
        const validator: ValidationService = ValidationService.getInstance()
        validator.validateConfig(sanitizedConfig)

        if (!existsSync(backupDir)) {
          mkdirSync(backupDir, { recursive: true })
        }

        const now = new Date()
        const datePart = now.toISOString().split('T')[0] ?? 'unknown-date'
        const timePart = (now.toISOString().split('T')[1] ?? '').split('.')[0]?.replace(/:/g, '-') ?? 'unknown-time'
        const timestamp = `${datePart}_${timePart}`
        const backupFilename = `firewall-backup-${timestamp}.json`
        const backupPath = join(backupDir, backupFilename)

        const backupConfig = {
          ...sanitizedConfig,
          backup: {
            createdAt: new Date().toISOString(),
            source: 'remote',
            provider: provider.name,
            ...(provider.name === 'vercel' ? { projectId, teamId } : {}),
            originalVersion: remoteConfig.version,
          },
        }

        // The underlying config was already validated above; skip validation
        // here only because the added `backup` metadata field isn't part of the
        // live config schema (additionalProperties: false). Restoring already
        // loads backups in 'raw' mode for the same reason.
        await saveConfig(backupConfig as unknown as FirewallConfig, backupPath, { validate: false })

        logger.success(chalk.green(`✅ Backup created: ${backupPath}`))
        logger.log('')
        logger.log(chalk.bold('Backup Details:'))
        logger.log(`${chalk.dim('Version:')} ${remoteConfig.version}`)
        logger.log(
          `${chalk.dim('Rules:')} ${remoteConfig.rules.length} custom, ${remoteConfig.ips?.length ?? 0} IP blocking`,
        )
        logger.log(`${chalk.dim('Created:')} ${new Date().toLocaleString()}`)
        logger.log('')
        logger.log(chalk.dim('To restore this backup later, run:'))
        logger.log(chalk.cyan(`doorman backup --restore ${backupFilename}`))
      },
    )
  } catch (error) {
    handleCommandError(error, 'managing backup')
  }
}
