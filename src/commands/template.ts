import chalk from 'chalk'
import { LogLevels } from 'consola'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import { firewallConfigSchema } from '../lib/schemas/firewallSchemas'
import { TemplateName, getTemplateConfig, templates } from '../lib/templates'
import { CustomRule, FirewallConfig } from '../lib/types'
import { prompt } from '../lib/ui/prompt'
import { getConfig, saveConfig } from '../lib/utils/config'
import { handleCommandError } from '../lib/utils/handleCommandError'

interface TemplateOptions {
  name?: string
  config?: string
  dryRun?: boolean
  debug?: boolean
  ci?: boolean
}

export const command = 'template [name]'
export const desc = 'Add a firewall rule template to your configuration'

export const builder = {
  name: {
    type: 'string',
    description: 'Name of the template to add',
  },
  config: {
    alias: 'c',
    type: 'string',
    description: 'Path to firewall config file (defaults to .doorman.json)',
  },
  dryRun: {
    alias: 'd',
    type: 'boolean',
    description: 'Preview changes without applying them',
    default: false,
  },
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

/**
 * Check the incoming template rules for name collisions with the existing
 * config, the same way add.ts's checkDuplicates does for a single rule.
 */
function findDuplicateNames(existingRules: CustomRule[], newRules: CustomRule[]): string[] {
  const existingNames = new Set(existingRules.map((r) => r.name.toLowerCase()))
  const duplicates = newRules.filter((rule) => existingNames.has(rule.name.toLowerCase())).map((rule) => rule.name)
  return [...new Set(duplicates)]
}

const getAvailableTemplates = (): TemplateName[] => {
  return Object.keys(templates) as TemplateName[]
}

export const handler = async (argv: Arguments<TemplateOptions>) => {
  try {
    if (argv.debug) {
      logger.level = LogLevels.debug
    }

    logger.debug('Template command arguments:', argv)

    // Get template name from argument or prompt
    let templateName = argv.name
    if (!templateName) {
      const templates = getAvailableTemplates()
      const selected = await prompt('Select a template to add:', {
        type: 'select',
        options: templates,
        initial: templates[0],
      })
      templateName = selected as string
    }

    const templateConfig = getTemplateConfig(templateName as TemplateName)
    if (!templateConfig) {
      logger.error(`Template not found: ${templateName}`)
      process.exit(1)
    }

    logger.debug('Template content:', templateConfig)

    // Load config without validation — we're about to modify it,
    // so we validate the result instead of the input.
    logger.start('Loading current configuration...')
    const config = await getConfig(argv.config, 'raw')
    const existingRules = config.rules || []

    // Check for rules that would collide with existing ones by name —
    // otherwise re-running the same template silently appends duplicates.
    // Computed before the dry-run branch so --dryRun actually previews this
    // warning too, instead of silently skipping the one thing a preview
    // most needs to surface.
    const duplicateNames = findDuplicateNames(existingRules, templateConfig.rules)

    if (argv.dryRun) {
      logger.info(chalk.cyan('\nDry run - The following rules would be added:'))
      logger.log(JSON.stringify(templateConfig.rules, null, 2))
      if (duplicateNames.length > 0) {
        logger.warn(chalk.yellow(`⚠️  Rule name(s) already exist in the configuration: ${duplicateNames.join(', ')}`))
      }
      return
    }

    if (duplicateNames.length > 0) {
      logger.warn(chalk.yellow(`⚠️  Rule name(s) already exist in the configuration: ${duplicateNames.join(', ')}`))

      // Matches the safe default (`initial: false`) a human would hit Enter
      // on — an unattended run shouldn't hang waiting for a terminal that
      // isn't there, and shouldn't silently duplicate rules either. See
      // #216: this used to fall through to `prompt()` unconditionally, which
      // crashed with a raw libuv error under CI/agents with no explicit
      // opt-out.
      if (argv.ci || !process.stdin.isTTY) {
        logger.info(chalk.dim('Skipping — non-interactive and rule name(s) already exist. Template not applied.'))
        return
      }

      const proceed = (await prompt('Proceed anyway?', {
        type: 'confirm',
        initial: false,
      })) as boolean
      if (!proceed) {
        logger.info('Cancelled.')
        return
      }
    }

    // Append the new rules to the existing configuration
    const updatedConfig: FirewallConfig = {
      ...config,
      rules: [...existingRules, ...templateConfig.rules],
    }

    // Validate the resulting config before saving
    const validationResult = firewallConfigSchema.safeParse(updatedConfig)
    if (!validationResult.success) {
      logger.error(chalk.red('The resulting configuration would be invalid:'))
      validationResult.error.errors.forEach((err) => {
        const path = err.path.join('.')
        logger.error(chalk.red(`  - ${path}: ${err.message}`))
      })
      logger.info(chalk.dim('Template was not applied. Fix the issues above and try again.'))
      process.exit(1)
    }

    logger.start('Saving updated configuration...')
    await saveConfig(updatedConfig, argv.config, { validate: false })
    logger.success(chalk.green(`Successfully added template '${templateName}' to configuration`))
  } catch (error) {
    handleCommandError(error, 'adding template')
  }
}
