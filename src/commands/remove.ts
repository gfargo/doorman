import chalk from 'chalk'
import { LogLevels } from 'consola'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import { CustomRule, FirewallConfig, IPBlockingRule } from '../lib/types'
import { prompt } from '../lib/ui/prompt'
import { getConfig, saveConfig } from '../lib/utils/config'
import { handleCommandError } from '../lib/utils/handleCommandError'

interface RemoveOptions {
  type?: string
  interactive?: boolean
  name?: string
  id?: string[]
  ip?: string
  disabled?: boolean
  all?: boolean
  force?: boolean
  config?: string
  dryRun?: boolean
  debug?: boolean
}

export const command = 'remove [type]'
export const aliases = ['rm', 'delete']
export const desc = 'Remove a firewall rule or IP entry from your configuration'

export const builder = {
  type: {
    type: 'string',
    description: 'What to remove: "rule" (default) or "ip"',
    default: 'rule',
    choices: ['rule', 'ip'],
  },
  interactive: {
    alias: 'i',
    type: 'boolean',
    description: 'Select rules to remove from a list',
    default: false,
  },
  name: {
    alias: 'n',
    type: 'string',
    description: 'Remove rule by name (exact match)',
  },
  id: {
    type: 'array',
    string: true,
    description: 'Remove rule by ID (supports multiple)',
  },
  ip: {
    type: 'string',
    description: 'Remove IP rule by IP address',
  },
  disabled: {
    type: 'boolean',
    description: 'Remove all disabled (active: false) rules',
    default: false,
  },
  all: {
    type: 'boolean',
    description: 'Remove all rules (requires confirmation)',
    default: false,
  },
  force: {
    alias: 'f',
    type: 'boolean',
    description: 'Skip confirmation prompt',
    default: false,
  },
  config: {
    alias: 'c',
    type: 'string',
    description: 'Config file path',
  },
  dryRun: {
    alias: 'd',
    type: 'boolean',
    description: 'Show what would be removed without writing',
    default: false,
  },
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
}

/**
 * Compute Levenshtein distance between two strings for fuzzy matching.
 */
export function levenshtein(a: string, b: string): number {
  const aLen = a.length
  const bLen = b.length

  if (aLen === 0) return bLen
  if (bLen === 0) return aLen

  // Use a flat array for better performance and type safety
  const prev: number[] = Array.from({ length: aLen + 1 }, (_, j) => j)
  const curr: number[] = new Array(aLen + 1).fill(0)

  for (let i = 1; i <= bLen; i++) {
    curr[0] = i
    for (let j = 1; j <= aLen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        curr[j] = prev[j - 1]!
      } else {
        curr[j] = Math.min(prev[j - 1]! + 1, curr[j - 1]! + 1, prev[j]! + 1)
      }
    }
    // Copy curr to prev
    for (let j = 0; j <= aLen; j++) {
      prev[j] = curr[j]!
    }
  }

  return prev[aLen]!
}

/**
 * Find fuzzy matches for a rule name.
 */
export function findFuzzyMatches(query: string, rules: CustomRule[], maxResults = 3): CustomRule[] {
  const queryLower = query.toLowerCase()

  // First try substring matching
  const substringMatches = rules.filter(
    (r) => r.name.toLowerCase().includes(queryLower) || queryLower.includes(r.name.toLowerCase()),
  )
  if (substringMatches.length > 0) {
    return substringMatches.slice(0, maxResults)
  }

  // Fall back to Levenshtein distance
  const scored = rules
    .map((r) => ({
      rule: r,
      distance: levenshtein(queryLower, r.name.toLowerCase()),
    }))
    .sort((a, b) => a.distance - b.distance)

  // Only return matches that are reasonably close (distance <= 60% of query length)
  const threshold = Math.max(query.length * 0.6, 3)
  return scored
    .filter((s) => s.distance <= threshold)
    .slice(0, maxResults)
    .map((s) => s.rule)
}

/**
 * Display a summary of rules that will be / were removed.
 */
function displayRemovalSummary(rules: CustomRule[]): void {
  for (const rule of rules) {
    const id = rule.id ? ` (${rule.id})` : ''
    const status = rule.active ? '' : chalk.dim(' [disabled]')
    const action = rule.action.mitigate.action
    logger.log(chalk.dim(`  - ${rule.name}${id} — ${action}${status}`))
  }
}

/**
 * Display a summary of IP rules that will be / were removed.
 */
function displayIPRemovalSummary(ips: IPBlockingRule[]): void {
  for (const ip of ips) {
    const notes = ip.notes ? ` — ${ip.notes}` : ''
    logger.log(chalk.dim(`  - ${ip.ip}${notes}`))
  }
}

/**
 * Confirm removal with the user unless --force is set.
 */
async function confirmRemoval(
  count: number,
  force: boolean,
  isAll: boolean,
  itemType: 'rule' | 'IP rule' = 'rule',
): Promise<boolean> {
  if (force) return true

  if (isAll) {
    const confirmation = (await prompt(
      chalk.red(`⚠️  Are you sure you want to remove ALL ${itemType}s? Type "YES" to confirm:`),
      { type: 'text' },
    )) as string
    return confirmation === 'YES'
  }

  const message = count === 1 ? `Confirm removal of 1 ${itemType}?` : `Confirm removal of ${count} ${itemType}s?`
  return (await prompt(message, { type: 'confirm', initial: false })) as boolean
}

export const handler = async (argv: Arguments<RemoveOptions>) => {
  try {
    if (argv.debug) {
      logger.level = LogLevels.debug
    }

    logger.debug('Remove command arguments:', argv)

    const ruleType = argv.type || 'rule'

    // Load config
    logger.start('Loading configuration...')
    const config = await getConfig(argv.config)

    if (ruleType === 'ip') {
      // --- IP Rule Removal ---
      const currentIPs = config.ips || []

      if (currentIPs.length === 0) {
        logger.info('No IP rules in configuration.')
        return
      }

      let toRemove: IPBlockingRule[] = []

      if (argv.interactive) {
        const options = currentIPs.map((ip) => {
          const notes = ip.notes ? ` — ${ip.notes}` : ''
          return `${ip.ip}${notes}`
        })

        const selected = (await prompt('Select IP rules to remove:', {
          type: 'multiselect',
          options,
        })) as string[]

        toRemove = currentIPs.filter((ip) => {
          const label = `${ip.ip}${ip.notes ? ` — ${ip.notes}` : ''}`
          return selected.includes(label)
        })
      } else if (argv.ip) {
        toRemove = currentIPs.filter((ip) => ip.ip === argv.ip)
        if (toRemove.length === 0) {
          logger.error(chalk.red(`No IP rule found matching "${argv.ip}"`))
          if (currentIPs.length > 0) {
            logger.log(chalk.dim('\nCurrent IP rules:'))
            displayIPRemovalSummary(currentIPs)
          }
          process.exit(1)
        }
      } else if (argv.all) {
        toRemove = [...currentIPs]
      } else {
        logger.error('Specify --ip, --interactive, or --all to select IP rules to remove.')
        process.exit(1)
      }

      if (toRemove.length === 0) {
        logger.info('No IP rules selected for removal.')
        return
      }

      // Show what will be removed
      logger.log(chalk.cyan(`\n${argv.dryRun ? 'Would remove' : 'Removing'} ${toRemove.length} IP rule(s):`))
      displayIPRemovalSummary(toRemove)

      if (argv.dryRun) {
        logger.log(chalk.dim('\nDry run — no changes made.'))
        return
      }

      // Confirm
      if (!(await confirmRemoval(toRemove.length, argv.force || false, argv.all || false, 'IP rule'))) {
        logger.info('Cancelled.')
        return
      }

      // Remove
      const removeIPs = new Set(toRemove.map((ip) => ip.ip))
      const updatedConfig: FirewallConfig = {
        ...config,
        ips: currentIPs.filter((ip) => !removeIPs.has(ip.ip)),
      }

      await saveConfig(updatedConfig, argv.config)
      logger.success(chalk.green(`✔ Removed ${toRemove.length} IP rule(s) from configuration`))
    } else {
      // --- Custom Rule Removal ---
      const currentRules = config.rules || []

      if (currentRules.length === 0) {
        logger.info('No rules in configuration.')
        return
      }

      let toRemove: CustomRule[] = []

      if (argv.interactive) {
        const options = currentRules.map((rule, idx) => {
          const id = rule.id ? ` (${rule.id})` : ''
          const status = rule.active ? '' : ' [disabled]'
          const action = rule.action.mitigate.action
          return `[${idx}] ${rule.name}${id} — ${action}${status}`
        })

        const selected = (await prompt('Select rules to remove:', {
          type: 'multiselect',
          options,
        })) as string[]

        toRemove = currentRules.filter((_rule, idx) => {
          return selected.some((s) => s.startsWith(`[${idx}]`))
        })
      } else if (argv.name) {
        // Exact name match
        toRemove = currentRules.filter((r) => r.name === argv.name)

        // Warn if multiple rules share the same name
        if (toRemove.length > 1) {
          logger.warn(chalk.yellow(`\n⚠️  Found ${toRemove.length} rules named "${argv.name}". All will be removed.`))
          displayRemovalSummary(toRemove)
        }

        if (toRemove.length === 0) {
          logger.error(chalk.red(`No rule found with exact name "${argv.name}"`))

          // Fuzzy suggestions
          const suggestions = findFuzzyMatches(argv.name, currentRules)
          if (suggestions.length > 0) {
            logger.log(chalk.yellow('\nDid you mean one of these?'))
            suggestions.forEach((s, i) => {
              const id = s.id ? ` (${s.id})` : ''
              logger.log(chalk.dim(`  ${i + 1}. ${s.name}${id}`))
            })
            logger.log(chalk.dim('\nUse --id for exact matching, or --interactive to select from a list.'))
          }
          process.exit(1)
        }
      } else if (argv.id && argv.id.length > 0) {
        const idsToRemove = new Set(argv.id)
        toRemove = currentRules.filter((r) => r.id && idsToRemove.has(r.id))

        const foundIds = new Set(toRemove.map((r) => r.id))
        const notFound = argv.id.filter((id) => !foundIds.has(id))
        if (notFound.length > 0) {
          logger.warn(chalk.yellow(`No rules found for IDs: ${notFound.join(', ')}`))
        }

        if (toRemove.length === 0) {
          logger.error(chalk.red('No matching rules found for the given IDs.'))
          process.exit(1)
        }
      } else if (argv.disabled) {
        toRemove = currentRules.filter((r) => !r.active)

        if (toRemove.length === 0) {
          logger.info('No disabled rules found.')
          return
        }
      } else if (argv.all) {
        toRemove = [...currentRules]
      } else {
        logger.error('Specify --name, --id, --disabled, --all, or --interactive to select rules to remove.')
        process.exit(1)
      }

      if (toRemove.length === 0) {
        logger.info('No rules selected for removal.')
        return
      }

      // Suggest backup for bulk operations
      if (toRemove.length >= 5 && !argv.dryRun && !argv.force) {
        logger.log(chalk.yellow(`\n💡 Tip: Run ${chalk.cyan('doorman backup')} before bulk removal operations.`))
      }

      // Show what will be removed
      logger.log(chalk.cyan(`\n${argv.dryRun ? 'Would remove' : 'Removing'} ${toRemove.length} rule(s):`))
      displayRemovalSummary(toRemove)

      if (argv.dryRun) {
        logger.log(chalk.dim('\nDry run — no changes made.'))
        return
      }

      // Confirm
      if (!(await confirmRemoval(toRemove.length, argv.force || false, argv.all || false))) {
        logger.info('Cancelled.')
        return
      }

      // Remove rules
      const removeSet = new Set(toRemove)
      const updatedConfig: FirewallConfig = {
        ...config,
        rules: currentRules.filter((r) => !removeSet.has(r)),
      }

      // Warn if config will have empty rules
      if (updatedConfig.rules.length === 0) {
        logger.warn(chalk.yellow('⚠️  Configuration will have no rules after removal.'))
      }

      await saveConfig(updatedConfig, argv.config)
      logger.success(chalk.green(`✔ Removed ${toRemove.length} rule(s) from configuration`))
      displayRemovalSummary(toRemove)
    }

    logger.log('')
    logger.log(chalk.dim(`Run ${chalk.cyan('doorman sync')} to deploy these changes.`))
  } catch (error) {
    handleCommandError(error, 'removing rule')
  }
}
