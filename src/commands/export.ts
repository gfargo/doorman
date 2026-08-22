import chalk from 'chalk'
import { writeFileSync } from 'fs'
import { Arguments } from 'yargs'
import { logger } from '../lib/logger'
import type { FirewallConfig } from '../lib/types'
import type { UnifiedConfig, UnifiedIPRule, UnifiedRule } from '../lib/types/unified'
import { getConfig } from '../lib/utils/config'
import { handleCommandError } from '../lib/utils/handleCommandError'
import { toUnifiedConfig } from '../lib/utils/vercelConfigAdapter'
import { providerOption } from '../lib/utils/providerOption'
import { withCredentials } from '../lib/utils/withCredentials'
import { credentialOptions, pickCredentialOptions, type CredentialOptions } from '../lib/utils/credentialOptions'

interface ExportOptions extends CredentialOptions {
  config?: string
  format?: 'json' | 'yaml' | 'terraform' | 'markdown'
  output?: string
  source?: 'local' | 'remote'
  debug?: boolean
  ci?: boolean
}

export const command = 'export'
export const desc = 'Export firewall configuration in various formats'

export const builder = {
  config: {
    alias: 'c',
    type: 'string',
    description: 'Path to firewall config file (defaults to .doorman.json)',
  },
  provider: providerOption,
  ...credentialOptions,
  format: {
    alias: 'f',
    type: 'string',
    choices: ['json', 'yaml', 'terraform', 'markdown'],
    description: 'Export format',
    default: 'json',
  },
  output: {
    alias: 'o',
    type: 'string',
    description: 'Output file path',
  },
  source: {
    alias: 's',
    type: 'string',
    choices: ['local', 'remote'],
    description: 'Export from local config or remote Vercel',
    default: 'local',
  },
  debug: {
    type: 'boolean',
    description: 'Enable debug logging',
    default: false,
  },
  ci: { type: 'boolean', description: 'Run in CI mode (non-interactive)', default: false },
}

/**
 * Groups a rule's flat `conditions[]` by `.group` (defaulting ungrouped
 * conditions to a single implicit group 0) — reconstructs the AND-within/
 * OR-across structure providers like Vercel model as nested condition
 * groups, for display purposes.
 */
function groupConditions(conditions: UnifiedRule['conditions']): UnifiedRule['conditions'][] {
  const groups = new Map<number, UnifiedRule['conditions']>()
  for (const condition of conditions) {
    const index = condition.group ?? 0
    const bucket = groups.get(index)
    if (bucket) {
      bucket.push(condition)
    } else {
      groups.set(index, [condition])
    }
  }
  return [...groups.values()]
}

const generateMarkdownReport = (config: UnifiedConfig): string => {
  const { rules, ips = [] } = config
  const version = config.metadata?.version
  const updatedAt = config.metadata?.updatedAt

  let markdown = `# Firewall Configuration Report\n\n`
  markdown += `**Provider:** ${config.provider ?? 'unknown'}\n`
  markdown += `**Version:** ${version ?? 'unknown'}\n`
  markdown += `**Last Updated:** ${updatedAt ? new Date(updatedAt).toLocaleString() : 'Unknown'}\n`
  markdown += `**Generated:** ${new Date().toLocaleString()}\n\n`

  markdown += `## Custom Rules (${rules.length})\n\n`
  if (rules.length > 0) {
    rules.forEach((rule: UnifiedRule, index: number) => {
      markdown += `### ${index + 1}. ${rule.name}\n\n`
      markdown += `- **ID:** \`${rule.id ?? 'unassigned'}\`\n`
      markdown += `- **Description:** ${rule.description || 'No description'}\n`
      markdown += `- **Action:** ${rule.action.type}\n`
      markdown += `- **Enabled:** ${rule.enabled ? '✅ Yes' : '❌ No'}\n`

      if (rule.action.rateLimit) {
        markdown += `- **Rate Limit:** ${rule.action.rateLimit.requests} requests per ${rule.action.rateLimit.window}\n`
      }

      markdown += `- **Conditions:**\n`
      groupConditions(rule.conditions).forEach((group, groupIndex) => {
        markdown += `  - Group ${groupIndex + 1}:\n`
        group.forEach((condition) => {
          markdown += `    - ${condition.field} ${condition.operator} \`${condition.value}\`\n`
        })
      })
      markdown += `\n`
    })
  } else {
    markdown += `No custom rules configured.\n\n`
  }

  markdown += `## IP Blocking Rules (${ips.length})\n\n`
  if (ips.length > 0) {
    markdown += `| IP Address | Hostname | Action |\n`
    markdown += `|------------|----------|--------|\n`
    ips.forEach((ip: UnifiedIPRule) => {
      markdown += `| \`${ip.ip}\` | ${ip.hostname || 'N/A'} | ${ip.action} |\n`
    })
  } else {
    markdown += `No IP blocking rules configured.\n`
  }

  return markdown
}

const generateTerraformConfig = (config: UnifiedConfig): string => {
  const { rules, ips = [] } = config

  let terraform = `# Firewall Configuration (${config.provider ?? 'unknown'})\n`
  terraform += `# Generated on ${new Date().toISOString()}\n\n`
  terraform += `# Note: This is a conceptual Terraform configuration\n`
  terraform += `# A provider-specific Terraform provider would need to be implemented for actual use\n\n`

  rules.forEach((rule: UnifiedRule, index: number) => {
    terraform += `resource "firewall_rule" "rule_${index}" {\n`
    terraform += `  name        = "${rule.name}"\n`
    terraform += `  description = "${rule.description || ''}"\n`
    terraform += `  enabled     = ${rule.enabled}\n`
    terraform += `  action      = "${rule.action.type}"\n`

    if (rule.action.rateLimit) {
      terraform += `  rate_limit {\n`
      terraform += `    requests = ${rule.action.rateLimit.requests}\n`
      terraform += `    window   = "${rule.action.rateLimit.window}"\n`
      terraform += `  }\n`
    }

    terraform += `}\n\n`
  })

  ips.forEach((ip: UnifiedIPRule, index: number) => {
    terraform += `resource "firewall_ip_blocking_rule" "ip_${index}" {\n`
    terraform += `  ip       = "${ip.ip}"\n`
    terraform += `  hostname = "${ip.hostname || ''}"\n`
    terraform += `  action   = "${ip.action}"\n`
    terraform += `}\n\n`
  })

  return terraform
}

export const handler = async (argv: Arguments<ExportOptions>) => {
  try {
    // The raw config as loaded/fetched, in whatever shape it's already in
    // (legacy or unified) — JSON export serializes this as-is, matching the
    // pre-migration behavior of round-tripping the on-disk file unchanged.
    // `provider.fetchConfig()` always returns a clean UnifiedConfig now
    // (for every provider), so a remote JSON export no longer leaks
    // API-only fields (id, crs, projectKey, ownerId, valid,
    // validationErrors) the way a raw Vercel API response used to.
    // No `--output` (or `-`) means the payload itself goes to stdout, so any
    // progress chrome printed ahead of it would land in the same stream a
    // caller might pipe or redirect (`doorman export --format json | jq`,
    // `... --format markdown > report.md`) — confirmed this isn't json-only,
    // every format is affected when redirected. Suppressed rather than moved
    // to stderr, matching list.ts/diff.ts; see #209.
    const isStdout = argv.output === '-' || !argv.output

    let config: FirewallConfig | UnifiedConfig

    if (argv.source === 'remote') {
      // Remote export needs credentials
      await withCredentials(
        {
          config: argv.config,
          provider: argv.provider,
          ...pickCredentialOptions(argv),
          debug: argv.debug,
          ci: argv.ci,
          errorContext: 'exporting configuration',
        },
        async ({ provider }) => {
          if (!isStdout) logger.start('Fetching remote configuration...')
          config = await provider.fetchConfig()
        },
      )
    } else {
      config = await getConfig(argv.config)
    }

    if (!isStdout) logger.start(`Exporting configuration in ${argv.format} format...`)

    let output: string
    let defaultExtension: string

    switch (argv.format) {
      case 'json':
        output = JSON.stringify(config!, null, 2)
        defaultExtension = 'json'
        break

      case 'yaml': {
        const unified = toUnifiedConfig(config!)
        output = `# Firewall Configuration (${unified.provider ?? 'unknown'})\n`
        output += `version: ${unified.metadata?.version ?? 'unknown'}\n`
        output += `updatedAt: "${unified.metadata?.updatedAt ?? ''}"\n`
        output += `rules:\n`
        unified.rules.forEach((rule: UnifiedRule) => {
          output += `  - name: "${rule.name}"\n`
          output += `    id: "${rule.id ?? ''}"\n`
          output += `    enabled: ${rule.enabled}\n`
          output += `    action: "${rule.action.type}"\n`
        })
        defaultExtension = 'yaml'
        break
      }

      case 'terraform':
        output = generateTerraformConfig(toUnifiedConfig(config!))
        defaultExtension = 'tf'
        break

      case 'markdown':
        output = generateMarkdownReport(toUnifiedConfig(config!))
        defaultExtension = 'md'
        break

      default:
        throw new Error(`Unsupported format: ${argv.format}`)
    }

    const outputPath = argv.output || `firewall-export.${defaultExtension}`

    if (isStdout) {
      logger.log(output)
    } else {
      writeFileSync(outputPath, output, 'utf8')
      logger.success(chalk.green(`✅ Exported to ${outputPath}`))

      logger.log('')
      logger.log(chalk.bold('Export Summary:'))
      logger.log(`${chalk.dim('Format:')} ${argv.format}`)
      logger.log(`${chalk.dim('Source:')} ${argv.source}`)
      logger.log(`${chalk.dim('Rules:')} ${config!.rules.length} custom, ${(config!.ips || []).length} IP blocking`)
      logger.log(`${chalk.dim('Size:')} ${(output.length / 1024).toFixed(1)} KB`)
    }
  } catch (error) {
    handleCommandError(error, 'exporting configuration')
  }
}
