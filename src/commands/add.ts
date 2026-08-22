import chalk from 'chalk'
import { LogLevels } from 'consola'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import { firewallRuleSchema, ipBlockingRuleSchema } from '../lib/schemas/firewallSchemas'
import {
  ActionType,
  ConditionGroup,
  CustomRule,
  FirewallConfig,
  IPBlockingRule,
  RuleCondition,
  RuleOperator,
  RuleType,
} from '../lib/types'
import { prompt } from '../lib/ui/prompt'
import { getConfig, saveConfig } from '../lib/utils/config'
import { handleCommandError } from '../lib/utils/handleCommandError'

interface AddOptions {
  type?: string
  interactive?: boolean
  name?: string
  description?: string
  field?: string
  op?: string
  value?: string
  key?: string
  neg?: boolean
  action?: string
  active?: boolean
  requests?: number
  window?: string
  duration?: string
  location?: string
  permanent?: boolean
  ip?: string
  hostname?: string
  notes?: string
  config?: string
  dryRun?: boolean
  debug?: boolean
  ci?: boolean
}

export const command = 'add [type]'
export const desc = 'Add a new firewall rule to your configuration'

export const builder = {
  type: {
    type: 'string',
    description: 'Rule type: "rule" (default) or "ip"',
    default: 'rule',
    choices: ['rule', 'ip'],
  },
  interactive: {
    alias: 'i',
    type: 'boolean',
    description: 'Guided prompts for rule creation',
    default: false,
  },
  name: {
    alias: 'n',
    type: 'string',
    description: 'Rule name',
  },
  description: {
    type: 'string',
    description: 'Rule description',
  },
  field: {
    type: 'string',
    description: 'Condition field type (path, method, user_agent, etc.)',
  },
  op: {
    type: 'string',
    description: 'Operator (eq, pre, suf, sub, inc, re, ex, nex)',
  },
  value: {
    type: 'string',
    description: 'Match value (string or comma-separated for arrays)',
  },
  key: {
    type: 'string',
    description: 'Header/query/cookie key (required for header, cookie types)',
  },
  neg: {
    type: 'boolean',
    description: 'Negate the condition',
    default: false,
  },
  action: {
    alias: 'a',
    type: 'string',
    description: 'Action type (deny, challenge, rate_limit, redirect, log, bypass)',
    default: 'deny',
  },
  active: {
    type: 'boolean',
    description: 'Enable rule immediately',
    default: true,
  },
  requests: {
    type: 'number',
    description: 'Rate limit: max requests',
  },
  window: {
    type: 'string',
    description: 'Rate limit: time window (e.g., "60s", "5m")',
  },
  duration: {
    type: 'string',
    description: 'Action duration (e.g., "1h", "permanent")',
  },
  location: {
    type: 'string',
    description: 'Redirect URL',
  },
  permanent: {
    type: 'boolean',
    description: 'Redirect: use 301 instead of 302',
  },
  ip: {
    type: 'string',
    description: 'IP address or CIDR for IP blocking rules',
  },
  hostname: {
    type: 'string',
    description: 'Hostname for IP blocking rules',
    default: '*',
  },
  notes: {
    type: 'string',
    description: 'Notes for IP blocking rules',
  },
  config: {
    alias: 'c',
    type: 'string',
    description: 'Config file path',
  },
  dryRun: {
    alias: 'd',
    type: 'boolean',
    description: 'Show what would be added without writing',
    default: false,
  },
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

const VALID_RULE_TYPES: RuleType[] = [
  'host',
  'path',
  'method',
  'header',
  'query',
  'cookie',
  'target_path',
  'ip_address',
  'region',
  'protocol',
  'scheme',
  'environment',
  'user_agent',
  'geo_continent',
  'geo_country',
  'geo_country_region',
  'geo_city',
  'geo_as_number',
  'ja4_digest',
  'ja3_digest',
  'rate_limit_api_id',
]

const VALID_OPERATORS: RuleOperator[] = ['eq', 'pre', 'suf', 'inc', 'sub', 're', 'ex', 'nex']

const VALID_ACTIONS: ActionType[] = ['log', 'deny', 'challenge', 'bypass', 'rate_limit', 'redirect']

/**
 * Generate a rule ID from a name.
 * "Block Admin Access" → "rule_block_admin_access"
 */
export function generateRuleId(name: string): string {
  const suffix = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

  if (!suffix) {
    throw new Error('Cannot generate rule ID: name must contain at least one alphanumeric character')
  }

  return 'rule_' + suffix
}

/**
 * Parse a value string into the appropriate type.
 * Comma-separated values become arrays (for `inc` operator).
 */
function parseValue(value: string, op: RuleOperator): string | string[] {
  if (op === 'inc') {
    return value.split(',').map((v) => v.trim())
  }
  return value
}

/**
 * Build a CustomRule from interactive prompts.
 */
async function buildRuleInteractive(): Promise<CustomRule> {
  const name = (await prompt('Rule name:', { type: 'text' })) as string
  if (!name.trim()) {
    throw new Error('Rule name cannot be empty')
  }

  const description = (await prompt('Description (optional):', { type: 'text' })) as string

  const conditionGroups: ConditionGroup[] = []
  let addMoreGroups = true

  while (addMoreGroups) {
    const conditions: RuleCondition[] = []
    let addMoreConditions = true

    while (addMoreConditions) {
      const fieldType = (await prompt('Condition type:', {
        type: 'select',
        options: VALID_RULE_TYPES as unknown as string[],
        initial: 'path',
      })) as string

      const op = (await prompt('Operator:', {
        type: 'select',
        options: VALID_OPERATORS as unknown as string[],
        initial: 'eq',
      })) as string

      let key: string | undefined
      if (fieldType === 'header' || fieldType === 'cookie' || fieldType === 'query') {
        key = (await prompt(`${fieldType} key:`, { type: 'text' })) as string
      }

      let value: string | string[] | undefined
      if (op !== 'ex' && op !== 'nex') {
        const rawValue = (await prompt('Value:', { type: 'text' })) as string
        value = parseValue(rawValue, op as RuleOperator)
      }

      const neg =
        op !== 'ex' && op !== 'nex'
          ? ((await prompt('Negate this condition?', { type: 'confirm', initial: false })) as boolean)
          : false

      const condition: RuleCondition = {
        type: fieldType as RuleType,
        op: op as RuleOperator,
        ...(value !== undefined && { value }),
        ...(key && { key }),
        ...(neg && { neg }),
      }

      conditions.push(condition)

      addMoreConditions = (await prompt('Add another condition to this group? (AND logic)', {
        type: 'confirm',
        initial: false,
      })) as boolean
    }

    conditionGroups.push({ conditions })

    addMoreGroups = (await prompt('Add another condition group? (OR logic)', {
      type: 'confirm',
      initial: false,
    })) as boolean
  }

  const action = (await prompt('Action:', {
    type: 'select',
    options: VALID_ACTIONS as unknown as string[],
    initial: 'deny',
  })) as string

  let rateLimit: { requests: number; window: string } | undefined
  if (action === 'rate_limit') {
    const requests = parseInt((await prompt('Max requests:', { type: 'text', initial: '100' })) as string, 10)
    const window = (await prompt('Time window (e.g., "60s", "1m", "1h"):', {
      type: 'text',
      initial: '60s',
    })) as string
    rateLimit = { requests, window }
  }

  let redirect: { location: string; permanent?: boolean } | undefined
  if (action === 'redirect') {
    const location = (await prompt('Redirect URL:', { type: 'text' })) as string
    const permanent = (await prompt('Permanent redirect (301)?', {
      type: 'confirm',
      initial: false,
    })) as boolean
    redirect = { location, ...(permanent && { permanent }) }
  }

  let actionDuration: string | undefined
  if (action === 'deny' || action === 'challenge') {
    const wantsDuration = (await prompt('Set action duration? (default: permanent)', {
      type: 'confirm',
      initial: false,
    })) as boolean
    if (wantsDuration) {
      actionDuration = (await prompt('Duration (e.g., "1h", "1d", "permanent"):', {
        type: 'text',
        initial: 'permanent',
      })) as string
    }
  }

  const active = (await prompt('Enable rule immediately?', {
    type: 'confirm',
    initial: true,
  })) as boolean

  const id = generateRuleId(name)

  return {
    id,
    name: name.trim(),
    ...(description.trim() && { description: description.trim() }),
    conditionGroup: conditionGroups,
    action: {
      mitigate: {
        action: action as ActionType,
        ...(rateLimit && { rateLimit }),
        ...(redirect && { redirect }),
        ...(actionDuration && { actionDuration }),
      },
    },
    active,
  }
}

/**
 * Build a CustomRule from inline CLI arguments.
 */
function buildRuleInline(argv: Arguments<AddOptions>): CustomRule {
  if (!argv.name) {
    throw new Error('--name is required in inline mode. Use --interactive for guided prompts.')
  }
  if (!argv.field) {
    throw new Error('--field is required in inline mode (e.g., --field path)')
  }
  if (!argv.op) {
    throw new Error('--op is required in inline mode (e.g., --op eq)')
  }

  const op = argv.op as RuleOperator
  if (!VALID_OPERATORS.includes(op)) {
    throw new Error(`Invalid operator "${argv.op}". Valid operators: ${VALID_OPERATORS.join(', ')}`)
  }

  const fieldType = argv.field as RuleType
  if (!VALID_RULE_TYPES.includes(fieldType)) {
    throw new Error(`Invalid field type "${argv.field}". Valid types: ${VALID_RULE_TYPES.join(', ')}`)
  }

  const actionType = (argv.action || 'deny') as ActionType
  if (!VALID_ACTIONS.includes(actionType)) {
    throw new Error(`Invalid action "${argv.action}". Valid actions: ${VALID_ACTIONS.join(', ')}`)
  }

  // Value is required unless operator is ex/nex
  if (op !== 'ex' && op !== 'nex' && !argv.value) {
    throw new Error('--value is required for the given operator')
  }

  // Key is required for header/cookie/query types
  if ((fieldType === 'header' || fieldType === 'cookie' || fieldType === 'query') && !argv.key) {
    throw new Error(`--key is required for "${fieldType}" condition type`)
  }

  // Rate limit validation
  if (actionType === 'rate_limit') {
    if (!argv.requests || !argv.window) {
      throw new Error('--requests and --window are required when action is rate_limit')
    }
  }

  // Redirect validation
  if (actionType === 'redirect') {
    if (!argv.location) {
      throw new Error('--location is required when action is redirect')
    }
  }

  const value = argv.value ? parseValue(argv.value, op) : undefined

  const condition: RuleCondition = {
    type: fieldType,
    op,
    ...(value !== undefined && { value }),
    ...(argv.key && { key: argv.key }),
    ...(argv.neg && { neg: true }),
  }

  const id = generateRuleId(argv.name)

  return {
    id,
    name: argv.name.trim(),
    ...(argv.description && { description: argv.description }),
    conditionGroup: [{ conditions: [condition] }],
    action: {
      mitigate: {
        action: actionType,
        ...(actionType === 'rate_limit' &&
          argv.requests &&
          argv.window && {
            rateLimit: { requests: argv.requests, window: argv.window },
          }),
        ...(actionType === 'redirect' &&
          argv.location && {
            redirect: { location: argv.location, ...(argv.permanent && { permanent: true }) },
          }),
        ...(argv.duration && { actionDuration: argv.duration }),
      },
    },
    active: argv.active !== false,
  }
}

/**
 * Build an IP blocking rule from interactive prompts.
 */
async function buildIPRuleInteractive(): Promise<IPBlockingRule> {
  const ip = (await prompt('IP address or CIDR (e.g., 192.168.1.100/32):', { type: 'text' })) as string
  if (!ip.trim()) {
    throw new Error('IP address cannot be empty')
  }

  const hostname = (await prompt('Hostname (use * for all):', {
    type: 'text',
    initial: '*',
  })) as string

  const notes = (await prompt('Notes (optional):', { type: 'text' })) as string

  return {
    ip: ip.trim(),
    hostname: hostname.trim() || '*',
    ...(notes.trim() && { notes: notes.trim() }),
    action: 'deny',
  }
}

/**
 * Build an IP blocking rule from inline CLI arguments.
 */
function buildIPRuleInline(argv: Arguments<AddOptions>): IPBlockingRule {
  if (!argv.ip) {
    throw new Error('--ip is required for IP blocking rules')
  }

  return {
    ip: argv.ip.trim(),
    hostname: argv.hostname || '*',
    ...(argv.notes && { notes: argv.notes }),
    action: 'deny',
  }
}

/**
 * Check for duplicate rule names or IDs in the config.
 */
function checkDuplicates(config: FirewallConfig, rule: CustomRule): string | null {
  const existingNames = config.rules.map((r) => r.name.toLowerCase())
  if (existingNames.includes(rule.name.toLowerCase())) {
    return `A rule named "${rule.name}" already exists`
  }

  const existingIds = config.rules.map((r) => r.id).filter(Boolean)
  if (rule.id && existingIds.includes(rule.id)) {
    return `A rule with ID "${rule.id}" already exists`
  }

  return null
}

/**
 * Display a summary of the added rule.
 */
function displayRuleSummary(rule: CustomRule): void {
  logger.log('')
  logger.log(chalk.bold(`  Rule: ${rule.name}`))
  if (rule.description) {
    logger.log(chalk.dim(`  Description: ${rule.description}`))
  }
  logger.log(chalk.dim(`  ID: ${rule.id}`))

  // Display conditions
  const conditionParts = rule.conditionGroup.map((group) => {
    return group.conditions
      .map((c) => {
        const negStr = c.neg ? 'NOT ' : ''
        const keyStr = c.key ? `[${c.key}] ` : ''
        const valueStr = Array.isArray(c.value) ? c.value.join(', ') : c.value || ''
        return `${negStr}${c.type} ${keyStr}${c.op} "${valueStr}"`
      })
      .join(' AND ')
  })
  logger.log(chalk.dim(`  Conditions: ${conditionParts.join(' OR ')}`))

  const actionStr = rule.action.mitigate.action
  const extras: string[] = []
  if (rule.action.mitigate.rateLimit) {
    extras.push(`${rule.action.mitigate.rateLimit.requests} req/${rule.action.mitigate.rateLimit.window}`)
  }
  if (rule.action.mitigate.redirect) {
    extras.push(`→ ${rule.action.mitigate.redirect.location}`)
  }
  if (rule.action.mitigate.actionDuration) {
    extras.push(`duration: ${rule.action.mitigate.actionDuration}`)
  }
  logger.log(chalk.dim(`  Action: ${actionStr}${extras.length ? ` (${extras.join(', ')})` : ''}`))
  logger.log(chalk.dim(`  Active: ${rule.active ? '✅' : '❌'}`))
}

/**
 * Display a summary of the added IP rule.
 */
function displayIPRuleSummary(rule: IPBlockingRule): void {
  logger.log('')
  logger.log(chalk.bold(`  IP Rule: ${rule.ip}`))
  logger.log(chalk.dim(`  Hostname: ${rule.hostname}`))
  if (rule.notes) {
    logger.log(chalk.dim(`  Notes: ${rule.notes}`))
  }
  logger.log(chalk.dim(`  Action: ${rule.action}`))
}

export const handler = async (argv: Arguments<AddOptions>) => {
  try {
    if (argv.debug) {
      logger.level = LogLevels.debug
    }

    logger.debug('Add command arguments:', argv)

    const ruleType = argv.type || 'rule'

    if (ruleType === 'ip') {
      // --- IP Blocking Rule ---
      const ipRule: IPBlockingRule = argv.interactive ? await buildIPRuleInteractive() : buildIPRuleInline(argv)

      // Validate the IP rule against schema
      const validationResult = ipBlockingRuleSchema.safeParse(ipRule)
      if (!validationResult.success) {
        logger.error(chalk.red('Rule validation failed:'))
        validationResult.error.errors.forEach((err) => {
          const path = err.path.join('.')
          logger.error(chalk.red(`  - ${path || 'ip'}: ${err.message}`))
        })
        process.exit(1)
      }

      if (argv.dryRun) {
        logger.info(chalk.cyan('\nDry run - The following IP rule would be added:'))
        displayIPRuleSummary(ipRule)
        logger.log('')
        logger.log(chalk.dim(JSON.stringify(ipRule, null, 2)))
        return
      }

      // Load config
      logger.start('Loading configuration...')
      const config = await getConfig(argv.config, 'raw')

      // Append IP rule
      const updatedConfig: FirewallConfig = {
        ...config,
        ips: [...(config.ips || []), ipRule],
      }

      await saveConfig(updatedConfig, argv.config)
      logger.success(chalk.green(`✔ IP rule "${ipRule.ip}" added to configuration`))
      displayIPRuleSummary(ipRule)
    } else {
      // --- Custom Firewall Rule ---
      const rule: CustomRule = argv.interactive ? await buildRuleInteractive() : buildRuleInline(argv)

      // Validate the rule against schema
      const validationResult = firewallRuleSchema.safeParse(rule)
      if (!validationResult.success) {
        logger.error(chalk.red('Rule validation failed:'))
        validationResult.error.errors.forEach((err) => {
          const path = err.path.join('.') || 'rule'
          logger.error(chalk.red(`  - ${path}: ${err.message}`))
        })
        process.exit(1)
      }

      if (argv.dryRun) {
        logger.info(chalk.cyan('\nDry run - The following rule would be added:'))
        displayRuleSummary(rule)
        logger.log('')
        logger.log(chalk.dim(JSON.stringify(rule, null, 2)))
        return
      }

      // Load config
      logger.start('Loading configuration...')
      const config = await getConfig(argv.config, 'raw')
      const rules = config.rules || []

      // Check for duplicates
      const duplicateWarning = checkDuplicates({ ...config, rules }, rule)
      if (duplicateWarning) {
        logger.warn(chalk.yellow(`⚠️  ${duplicateWarning}`))

        // See template.ts's identical guard and #216 — matches the safe
        // `initial: false` default rather than crashing on a missing TTY.
        if (argv.ci || !process.stdin.isTTY) {
          logger.info(chalk.dim('Skipping — non-interactive and a conflicting rule already exists. Rule not added.'))
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

      // Append rule
      const updatedConfig: FirewallConfig = {
        ...config,
        rules: [...rules, rule],
      }

      await saveConfig(updatedConfig, argv.config)
      logger.success(chalk.green(`✔ Rule "${rule.name}" added to configuration`))
      displayRuleSummary(rule)
    }

    logger.log('')
    logger.log(chalk.dim(`Run ${chalk.cyan('doorman sync')} to deploy this rule.`))
  } catch (error) {
    handleCommandError(error, 'adding rule')
  }
}
