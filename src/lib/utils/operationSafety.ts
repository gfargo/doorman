import { logger } from '../logger'
import { prompt } from '../ui/prompt'
import type { UnifiedConfig } from '../types/unified'
import type { ChangeSet } from '../providers/IFirewallProvider'

/**
 * Safety confirmation options
 */
export interface SafetyConfirmationOptions {
  operation: string
  target: string
  changes?: ChangeSet
  riskLevel: 'low' | 'medium' | 'high'
  skipConfirmation?: boolean
  dryRun?: boolean
}

/**
 * Backup recommendation options
 */
export interface BackupRecommendation {
  recommended: boolean
  reason: string
  instructions: string[]
}

/**
 * Rollback guidance options
 */
export interface RollbackGuidance {
  available: boolean
  method: string
  instructions: string[]
  timeWindow?: string
}

/**
 * Operation safety utilities for Cloudflare operations
 * Provides confirmation prompts, dry-run validation, backup recommendations, and rollback guidance
 */
export class OperationSafety {
  /**
   * Confirm destructive operations with user
   */
  public static async confirmDestructiveOperation(options: SafetyConfirmationOptions): Promise<boolean> {
    const { operation, target, changes, riskLevel, skipConfirmation = false, dryRun = false } = options

    // Skip confirmation if explicitly requested or in dry-run mode
    if (skipConfirmation || dryRun) {
      if (dryRun) {
        logger.info(`🔍 Dry run mode: Would perform ${operation} on ${target}`)
      }
      return true
    }

    // Display operation summary
    logger.info(`\n🚨 Destructive Operation Confirmation`)
    logger.info(`Operation: ${operation}`)
    logger.info(`Target: ${target}`)
    logger.info(`Risk Level: ${this.formatRiskLevel(riskLevel)}`)

    // Display changes if available
    if (changes) {
      this.displayChangeSummary(changes)
    }

    // Show risk-specific warnings
    this.displayRiskWarnings(riskLevel, operation)

    // Show backup recommendation
    const backupRec = this.getBackupRecommendation(operation, riskLevel)
    if (backupRec.recommended) {
      logger.warn(`\n💾 Backup Recommended: ${backupRec.reason}`)
      backupRec.instructions.forEach((instruction) => {
        logger.info(`   • ${instruction}`)
      })
    }

    // Show rollback guidance
    const rollbackGuidance = this.getRollbackGuidance(operation)
    if (rollbackGuidance.available) {
      logger.info(`\n🔄 Rollback Available: ${rollbackGuidance.method}`)
      if (rollbackGuidance.timeWindow) {
        logger.info(`   Time Window: ${rollbackGuidance.timeWindow}`)
      }
    }

    // Get user confirmation
    const confirmationMessage = this.getConfirmationMessage(riskLevel, operation)
    const confirmed = await prompt(confirmationMessage, { type: 'confirm' })

    if (!confirmed) {
      logger.info('Operation cancelled by user')
      return false
    }

    logger.info('✅ Operation confirmed by user')
    return true
  }

  /**
   * Perform dry-run validation before actual changes.
   *
   * `issues` are structural problems that make the config unsafe to sync at all
   * (e.g. malformed shape) and always block the operation. `warnings` are risk
   * signals (large deletion ratio, duplicate names, etc.) that should be surfaced
   * to the user via the risk-assessment/confirmation flow below, not treated as
   * unrecoverable failures — otherwise a config that's merely risky (or just has
   * two rules with the same name) can never be synced, even with --force.
   */
  public static async performDryRunValidation(
    config: UnifiedConfig,
    operation: string,
    validateFn: (config: UnifiedConfig) => Promise<ChangeSet>,
  ): Promise<{ valid: boolean; changes: ChangeSet; issues: string[]; warnings: string[] }> {
    logger.info(`🔍 Performing dry-run validation for ${operation}...`)

    const issues: string[] = []
    const warnings: string[] = []
    let changes: ChangeSet = {
      rulesToAdd: [],
      rulesToUpdate: [],
      rulesToDelete: [],
      ipsToAdd: [],
      ipsToUpdate: [],
      ipsToDelete: [],
      hasChanges: false,
    }

    try {
      // Validate configuration structure — real, unrecoverable errors
      this.validateConfigurationStructure(config, issues)

      // Perform operation-specific validation
      changes = await validateFn(config)

      // Risk signals — surfaced as warnings, not hard failures
      this.validateChanges(changes, warnings)
      this.checkForPotentialIssues(config, changes, warnings)

      const valid = issues.length === 0

      if (valid) {
        logger.info('✅ Dry-run validation passed')
      } else {
        logger.warn(`⚠️  Dry-run validation found ${issues.length} issues:`)
        issues.forEach((issue) => logger.warn(`   • ${issue}`))
      }

      if (warnings.length > 0) {
        logger.warn(`⚠️  Dry-run validation found ${warnings.length} warning(s):`)
        warnings.forEach((warning) => logger.warn(`   • ${warning}`))
      }

      return { valid, changes, issues, warnings }
    } catch (error) {
      const errorMessage = `Dry-run validation failed: ${error instanceof Error ? error.message : String(error)}`
      issues.push(errorMessage)
      logger.error(errorMessage)

      return { valid: false, changes, issues, warnings }
    }
  }

  /**
   * Get backup recommendation for operation
   */
  public static getBackupRecommendation(operation: string, riskLevel: 'low' | 'medium' | 'high'): BackupRecommendation {
    const operationBackups: Record<string, BackupRecommendation> = {
      'sync rules': {
        recommended: riskLevel !== 'low',
        reason: 'Rule synchronization can overwrite existing firewall configuration',
        instructions: [
          'Run "doorman download" to backup current Cloudflare rules',
          'Save the downloaded configuration file with a timestamp',
          'Consider using version control for configuration files',
        ],
      },
      'delete ruleset': {
        recommended: true,
        reason: 'Ruleset deletion is irreversible and removes all associated rules',
        instructions: [
          'Export current ruleset with "doorman export"',
          'Document the ruleset ID and configuration',
          'Ensure you have the original configuration files',
        ],
      },
      'update rules': {
        recommended: riskLevel === 'high',
        reason: 'Rule updates can affect traffic flow and security posture',
        instructions: [
          'Download current configuration as backup',
          'Test changes in a staging environment if possible',
          'Have rollback plan ready',
        ],
      },
      'clear all rules': {
        recommended: true,
        reason: 'Clearing all rules removes all firewall protection',
        instructions: [
          'Export complete configuration with "doorman export"',
          'Save configuration to version control',
          'Document business justification for clearing rules',
        ],
      },
    }

    return (
      operationBackups[operation] || {
        recommended: riskLevel !== 'low',
        reason: 'Operation may modify existing configuration',
        instructions: ['Download current configuration as backup', 'Document the changes being made'],
      }
    )
  }

  /**
   * Get rollback guidance for operation
   */
  public static getRollbackGuidance(operation: string): RollbackGuidance {
    const rollbackGuidance: Record<string, RollbackGuidance> = {
      'sync rules': {
        available: true,
        method: 'Restore from backup configuration',
        instructions: [
          'Use "doorman sync" with your backup configuration file',
          'Or manually restore rules in Cloudflare dashboard',
          'Check that all rules are functioning as expected',
        ],
        timeWindow: 'No time limit - can rollback anytime',
      },
      'delete ruleset': {
        available: false,
        method: 'Recreation required',
        instructions: [
          'Deleted rulesets cannot be restored',
          'Must recreate ruleset and rules from backup',
          'Use "doorman sync" with backup configuration',
        ],
      },
      'update rules': {
        available: true,
        method: 'Restore previous rule version',
        instructions: [
          'Sync with previous configuration version',
          'Or use Cloudflare dashboard to revert changes',
          'Verify rule functionality after rollback',
        ],
        timeWindow: 'Immediate - no time restrictions',
      },
      'clear all rules': {
        available: true,
        method: 'Restore from backup',
        instructions: [
          'Sync with backup configuration file',
          'Verify all rules are restored correctly',
          'Test firewall functionality',
        ],
        timeWindow: 'No time limit',
      },
    }

    return (
      rollbackGuidance[operation] || {
        available: true,
        method: 'Restore from backup',
        instructions: ['Use backup configuration to restore previous state', 'Verify changes are reverted correctly'],
      }
    )
  }

  /**
   * Format risk level with appropriate styling
   */
  private static formatRiskLevel(riskLevel: 'low' | 'medium' | 'high'): string {
    const chalk = require('chalk')

    switch (riskLevel) {
      case 'low':
        return chalk.green('LOW')
      case 'medium':
        return chalk.yellow('MEDIUM')
      case 'high':
        return chalk.red('HIGH')
      default:
        return String(riskLevel).toUpperCase()
    }
  }

  /**
   * Display change summary
   */
  private static displayChangeSummary(changes: ChangeSet): void {
    logger.info('\n📊 Change Summary:')

    if (changes.rulesToAdd?.length) {
      logger.info(`   • Rules to add: ${changes.rulesToAdd.length}`)
    }
    if (changes.rulesToUpdate?.length) {
      logger.info(`   • Rules to update: ${changes.rulesToUpdate.length}`)
    }
    if (changes.rulesToDelete?.length) {
      logger.info(`   • Rules to delete: ${changes.rulesToDelete.length}`)
    }
    if (changes.ipsToAdd?.length) {
      logger.info(`   • IPs to add: ${changes.ipsToAdd.length}`)
    }
    if (changes.ipsToUpdate?.length) {
      logger.info(`   • IPs to update: ${changes.ipsToUpdate.length}`)
    }
    if (changes.ipsToDelete?.length) {
      logger.info(`   • IPs to delete: ${changes.ipsToDelete.length}`)
    }

    if (!changes.hasChanges) {
      logger.info('   • No changes detected')
    }
  }

  /**
   * Display risk-specific warnings
   */
  private static displayRiskWarnings(riskLevel: 'low' | 'medium' | 'high', operation: string): void {
    const warnings: Record<string, string[]> = {
      low: ['This operation has minimal risk of disrupting service'],
      medium: ['This operation may temporarily affect traffic filtering', 'Monitor your application after the change'],
      high: [
        '⚠️  This operation can significantly impact security and traffic flow',
        '⚠️  Ensure you have tested the configuration in a safe environment',
        '⚠️  Have a rollback plan ready before proceeding',
      ],
    }

    const operationWarnings: Record<string, string[]> = {
      'clear all rules': [
        '🚨 This will remove ALL firewall protection',
        '🚨 Your application will be unprotected until new rules are added',
      ],
      'delete ruleset': ['🚨 This action is IRREVERSIBLE', '🚨 All rules in the ruleset will be permanently deleted'],
    }

    logger.info('\n⚠️  Warnings:')

    // Show risk-level warnings
    warnings[riskLevel]?.forEach((warning) => {
      logger.warn(`   ${warning}`)
    })

    // Show operation-specific warnings
    operationWarnings[operation]?.forEach((warning) => {
      logger.warn(`   ${warning}`)
    })
  }

  /**
   * Get confirmation message based on risk level
   */
  private static getConfirmationMessage(riskLevel: 'low' | 'medium' | 'high', operation: string): string {
    const baseMessage = `Do you want to proceed with ${operation}?`

    switch (riskLevel) {
      case 'high':
        return `${baseMessage} (Type 'yes' to confirm high-risk operation)`
      case 'medium':
        return `${baseMessage} (Proceed with caution)`
      default:
        return baseMessage
    }
  }

  /**
   * Validate configuration structure
   */
  private static validateConfigurationStructure(config: UnifiedConfig, issues: string[]): void {
    if (!config) {
      issues.push('Configuration is null or undefined')
      return
    }

    if (!config.version) {
      issues.push('Configuration missing version field')
    }

    if (!config.provider) {
      issues.push('Configuration missing provider field')
    }

    if (!Array.isArray(config.rules)) {
      issues.push('Configuration rules field is not an array')
    }

    if (config.ips && !Array.isArray(config.ips)) {
      issues.push('Configuration ips field is not an array')
    }
  }

  /**
   * Assess changes for risk signals (deletion ratio, changeset size). These are
   * warnings, not blocking errors — see performDryRunValidation.
   */
  private static validateChanges(changes: ChangeSet, warnings: string[]): void {
    // Check for excessive deletions
    const totalDeletions = (changes.rulesToDelete?.length || 0) + (changes.ipsToDelete?.length || 0)
    const totalChanges =
      (changes.rulesToAdd?.length || 0) +
      (changes.rulesToUpdate?.length || 0) +
      (changes.ipsToAdd?.length || 0) +
      (changes.ipsToUpdate?.length || 0) +
      totalDeletions

    if (totalDeletions > 0 && totalChanges > 0) {
      const deletionRatio = totalDeletions / totalChanges
      if (deletionRatio > 0.5) {
        warnings.push(`High deletion ratio detected: ${Math.round(deletionRatio * 100)}% of changes are deletions`)
      }
    }

    // Check for large number of changes
    if (totalChanges > 100) {
      warnings.push(`Large number of changes detected: ${totalChanges} total changes`)
    }
  }

  /**
   * Check configuration and changes for risk signals (all rules deleted,
   * potentially traffic-blocking rules, duplicate names, etc). These are
   * warnings, not blocking errors — see performDryRunValidation.
   */
  private static checkForPotentialIssues(config: UnifiedConfig, changes: ChangeSet, warnings: string[]): void {
    // Check if all rules are being deleted
    if (changes.rulesToDelete?.length === config.rules.length && config.rules.length > 0) {
      warnings.push('All existing rules will be deleted - this removes all firewall protection')
    }

    // Check for rules that might block all traffic
    const potentiallyBlockingRules = config.rules.filter(
      (rule) =>
        rule.action.type === 'deny' &&
        rule.conditions.some(
          (condition) => condition.field === 'path' && (condition.value === '/' || condition.value === '*'),
        ),
    )

    if (potentiallyBlockingRules.length > 0) {
      warnings.push(`Found ${potentiallyBlockingRules.length} rules that may block all traffic`)
    }

    // Check for very large IP lists
    if (config.ips && config.ips.length > 1000) {
      warnings.push(`Large IP list detected: ${config.ips.length} IPs may impact performance`)
    }

    // Check for duplicate rule names
    const ruleNames = config.rules.map((rule) => rule.name)
    const duplicateNames = ruleNames.filter((name, index) => ruleNames.indexOf(name) !== index)
    if (duplicateNames.length > 0) {
      warnings.push(`Duplicate rule names found: ${[...new Set(duplicateNames)].join(', ')}`)
    }
  }
}
