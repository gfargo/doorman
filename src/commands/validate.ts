import type { ErrorObject } from 'ajv'
import chalk from 'chalk'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import { firewallConfigSchema } from '../lib/schemas/firewallSchemas'
import { unifiedConfigSchema } from '../lib/schemas/unifiedSchemas'
import { ValidationError, ValidationService } from '../lib/services/ValidationService'
import { hasProviderMetadata } from '../lib/types'
import { getConfig } from '../lib/utils/config'
import { handleCommandError } from '../lib/utils/handleCommandError'

interface ValidateOptions {
  config?: string
  verbose?: boolean
}

export const command = 'validate'
export const desc = 'Validate firewall configuration file'

export const builder = {
  config: {
    alias: 'c',
    type: 'string',
    description: 'Path to firewall config file (defaults to .doorman.json)',
  },
  verbose: {
    alias: 'v',
    type: 'boolean',
    description: 'Show detailed validation results',
    default: false,
  },
}

export const handler = async (argv: Arguments<ValidateOptions>) => {
  try {
    // Load config without validation since we'll do that ourselves
    const configJson = await getConfig(argv.config, 'raw')
    const validator: ValidationService = ValidationService.getInstance()
    // Multi-provider (Unified) configs — e.g. Cloudflare — use a different rule
    // shape than the legacy Vercel-only schema, so validate against the matching
    // schema (mirrors the routing in ValidationService.validateConfig).
    const isMultiProviderConfig = hasProviderMetadata(configJson)

    if (argv.verbose) {
      logger.start('Validating configuration file...\n')
    }

    // Run Zod validation first
    const zodResult = isMultiProviderConfig
      ? unifiedConfigSchema.safeParse(configJson)
      : firewallConfigSchema.safeParse(configJson)
    if (argv.verbose) {
      logger.log(chalk.bold.underline('Zod Schema Validation:'))
      if (zodResult.success) {
        logger.log(chalk.green('✓ Schema validation passed'))
      } else {
        logger.error(chalk.red('✗ Schema validation failed:'))
        zodResult.error.errors.forEach((err) => {
          const path = err.path.join('.')
          logger.error(chalk.red(`  - ${path}: ${err.message}`))
        })
      }
    }

    // Run AJV validation
    let ajvValid = true
    let ajvErrors: ErrorObject[] = []
    try {
      validator.validateConfig(configJson)
      if (argv.verbose) {
        logger.log(chalk.bold.underline('\nAJV Schema Validation:'))
        logger.log(chalk.green('✓ JSON Schema validation passed'))
      }
    } catch (error) {
      ajvValid = false
      if (error instanceof ValidationError) {
        ajvErrors = error.ajvErrors || []
        if (argv.verbose) {
          logger.log(chalk.bold.underline('\nAJV Schema Validation:'))
          logger.error(chalk.red('✗ JSON Schema validation failed:'))
          ajvErrors.forEach((err) => {
            logger.error(chalk.red(`  - ${err.instancePath}: ${err.message}`))
          })
        }
      } else {
        throw error
      }
    }

    // Run custom validations if both schema validations pass
    if (zodResult.success && ajvValid) {
      if (argv.verbose) {
        logger.log(chalk.bold.underline('\nCustom Validations:'))
        const config = zodResult.data

        // Rule name uniqueness
        const names = new Set<string>()
        const duplicates = new Set<string>()
        for (const rule of config.rules) {
          if (names.has(rule.name)) {
            duplicates.add(rule.name)
          }
          names.add(rule.name)
        }

        logger.log(`${chalk.cyan.dim('\nRule Names:')}`)
        if (duplicates.size > 0) {
          logger.error(chalk.red('✗ Duplicate rule names found:'))
          duplicates.forEach((name) => logger.error(chalk.red(`  - "${name}"`)))
        } else {
          logger.log(chalk.green('✓ All rule names are unique'))
        }

        logger.log('') // Empty line before final message
      }
    }

    // Final result
    if (zodResult.success && ajvValid) {
      logger.success(chalk.green('Configuration is valid'))
    } else if (argv.verbose) {
      // The detailed breakdown was already printed above — a bare message
      // here avoids showing every failure twice.
      throw new Error('Configuration validation failed')
    } else {
      // Surface *why*, not just *that* it failed, even without --verbose —
      // previously this was the only path to any detail at all, which made
      // a real failure (e.g. #219) meaningfully harder to diagnose than it
      // needed to be.
      const details = [
        ...(!zodResult.success
          ? zodResult.error.errors.map((err) => `${err.path.join('.') || '(root)'}: ${err.message}`)
          : []),
        ...(!ajvValid ? ajvErrors.map((err) => `${err.instancePath || '(root)'}: ${err.message}`) : []),
      ]
      throw new Error(`Configuration validation failed:\n  ${details.join('\n  ')}`)
    }
  } catch (error) {
    handleCommandError(error, 'validating configuration')
  }
}
