import chalk from 'chalk'
import { logger } from '../../logger'
import { BaseFirewallService } from '../BaseFirewallService'
import { VercelClient } from './VercelClient'
import { RuleTranslator } from '../../translators'
import { isDeepEqual } from '../../utils/isDeepEqual'
import { omitId } from '../../utils/omitId'
import { retry } from '../../utils/retry'
import { firewallConfigSchema } from '../../schemas/firewallSchemas'
import type {
  IFirewallProvider,
  ProviderType,
  SyncOptions,
  SyncResult,
  ChangeSet,
  FeatureSet,
  HealthScore,
  HealthIssue,
  ValidationResult,
} from '../IFirewallProvider'
import type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from '../../types/unified'
import type { CustomRule, IPBlockingRule } from '../../types/vercel'

/**
 * Vercel Firewall Service
 * Implements IFirewallProvider for Vercel Firewall
 */
export class VercelFirewallService extends BaseFirewallService implements IFirewallProvider {
  public readonly name: ProviderType = 'vercel'

  constructor(private client: VercelClient) {
    super()
  }

  /**
   * Fetch configuration from Vercel
   */
  async fetchConfig(version?: number): Promise<UnifiedConfig> {
    try {
      logger.debug('Fetching Vercel firewall configuration')
      const vercelConfig = await this.client.fetchFirewallConfig(version)

      // Convert Vercel format to unified format
      const rules: UnifiedRule[] = vercelConfig.rules.map((rule) => {
        const translation = RuleTranslator.vercelToUnified(rule)
        if (translation.warnings.length > 0) {
          translation.warnings.forEach((w) => {
            const { TranslationWarningSystem } = require('../../translators/TranslationWarningSystem')
            const formattedWarning = TranslationWarningSystem.formatWarning(w)
            logger.warn(`Rule ${rule.name}:\n${formattedWarning}`)
          })
        }
        return translation.result
      })

      const ips: UnifiedIPRule[] = vercelConfig.ips.map((ip) => RuleTranslator.vercelIPToUnified(ip))

      return {
        version: '2.0',
        provider: 'vercel',
        rules,
        ips,
        metadata: {
          version: vercelConfig.version,
          updatedAt: vercelConfig.updatedAt,
        },
      }
    } catch (error) {
      logger.error('Error fetching Vercel configuration:', error)
      throw new Error('Failed to fetch Vercel firewall configuration')
    }
  }

  /**
   * Sync rules to Vercel
   */
  async syncRules(config: UnifiedConfig, options: SyncOptions = {}): Promise<SyncResult> {
    const { dryRun = false } = options

    try {
      // Import operation safety utilities — this gives Vercel the same
      // dry-run validation/risk-assessment/confirmation safety check
      // CloudflareFirewallService.syncRules already has. Previously this was
      // scoped to Cloudflare only, so a destructive Vercel sync (e.g. one
      // that deletes every remote rule due to a bad local config) proceeded
      // with no dry-run check and no confirmation prompt.
      const { OperationSafety } = require('../../utils/operationSafety')

      // Compute changes without allowing a missing remote config to be
      // created — that create-prompt/mutating-PUT path (in
      // VercelClient.fetchFirewallConfig) must not run before we know
      // whether this is a dry run. See getChanges' `allowCreate` option.
      const dryRunResult = await OperationSafety.performDryRunValidation(
        config,
        'sync rules',
        async (cfg: UnifiedConfig) => await this.getChanges(cfg, { allowCreate: !dryRun }),
      )

      if (!dryRunResult.valid) {
        throw new Error(`Dry-run validation failed: ${dryRunResult.issues.join(', ')}`)
      }

      const changes = dryRunResult.changes as ChangeSet & { version: number }
      const { rulesToAdd, rulesToUpdate, rulesToDelete, version } = changes
      const ipsToAdd = changes.ipsToAdd || []
      const ipsToUpdate = changes.ipsToUpdate || []
      const ipsToDelete = changes.ipsToDelete || []

      if (dryRun) {
        logger.info('Dry run mode. The following changes would be made:')
        logger.info(
          `Custom Rules - Add: ${rulesToAdd.length}, Update: ${rulesToUpdate.length}, Delete: ${rulesToDelete.length}`,
        )
        logger.info(`IP Rules - Add: ${ipsToAdd.length}, Update: ${ipsToUpdate.length}, Delete: ${ipsToDelete.length}`)
        return {
          success: true,
          rulesAdded: 0,
          rulesUpdated: 0,
          rulesDeleted: 0,
          ipsAdded: 0,
          ipsUpdated: 0,
          ipsDeleted: 0,
          version,
          warnings: dryRunResult.warnings,
        }
      }

      const riskLevel = OperationSafety.assessOperationRisk(changes, config)
      const confirmed = await OperationSafety.confirmDestructiveOperation({
        operation: 'sync rules',
        target: `Vercel project ${this.client['projectId']}`,
        changes,
        riskLevel,
        skipConfirmation: options.force || false,
        dryRun: false,
        allowDeletions: options.allowDeletions || false,
      })

      if (!confirmed) {
        throw new Error('Operation cancelled by user')
      }

      // Convert unified rules back to Vercel format for API calls
      const toAdd: CustomRule[] = rulesToAdd.map((rule) => RuleTranslator.unifiedToVercel(rule).result)
      const toUpdate: CustomRule[] = rulesToUpdate.map((rule) => RuleTranslator.unifiedToVercel(rule).result)
      const toDelete: CustomRule[] = rulesToDelete.map((rule) => RuleTranslator.unifiedToVercel(rule).result)

      // Convert unified IP rules back to Vercel format for API calls
      const ipRulesToAdd: IPBlockingRule[] = ipsToAdd.map((ip) => ({
        id: ip.id || '',
        ip: ip.ip,
        hostname: ip.hostname || '',
        action: ip.action as 'deny',
        notes: ip.notes,
      }))
      const ipRulesToUpdate: IPBlockingRule[] = ipsToUpdate.map((ip) => ({
        id: ip.id || '',
        ip: ip.ip,
        hostname: ip.hostname || '',
        action: ip.action as 'deny',
        notes: ip.notes,
      }))
      const ipRulesToDelete: IPBlockingRule[] = ipsToDelete.map((ip) => ({
        id: ip.id || '',
        ip: ip.ip,
        hostname: ip.hostname || '',
        action: ip.action as 'deny',
        notes: ip.notes,
      }))

      const addedRules: CustomRule[] = []
      const updatedRules: CustomRule[] = []
      const deletedRules: CustomRule[] = []

      const addedIPRules: IPBlockingRule[] = []
      const updatedIPRules: IPBlockingRule[] = []
      const deletedIPRules: IPBlockingRule[] = []

      // Collected per-item failures across all six sub-loops below. A
      // single item exhausting its retries no longer aborts the whole sync
      // (and every independent operation still queued) — it's recorded
      // here, the loop moves on, and the final SyncResult reports exactly
      // what succeeded and what didn't via `errors`/`success`, instead of
      // throwing away all progress information.
      const errors: string[] = []
      const describeError = (context: string, error: unknown): string =>
        `${context}: ${error instanceof Error ? error.message : String(error)}`

      // Delete custom rules
      for (const rule of toDelete) {
        try {
          logger.debug(`Deleting custom rule: ${rule.id}`)
          await retry(() => this.client.deleteFirewallRule(rule), { maxAttempts: 3 })
          deletedRules.push(rule)
          logger.debug(`Custom rule deleted: ${rule.id}`)
        } catch (error) {
          logger.error(`Failed to delete custom rule ${rule.id}:`, error)
          errors.push(describeError(`Failed to delete custom rule ${rule.id}`, error))
        }
      }

      // Delete IP blocking rules
      for (const rule of ipRulesToDelete) {
        try {
          logger.debug(`Deleting IP blocking rule: ${rule.id}`)
          await retry(() => this.client.deleteIPBlockingRule(rule), { maxAttempts: 3 })
          deletedIPRules.push(rule)
          logger.debug(`IP blocking rule deleted: ${rule.id}`)
        } catch (error) {
          logger.error(`Failed to delete IP blocking rule ${rule.id}:`, error)
          errors.push(describeError(`Failed to delete IP blocking rule ${rule.id}`, error))
        }
      }

      // Add new custom rules
      for (const rule of toAdd) {
        try {
          logger.debug(`Adding new custom rule: ${rule.name}`)
          const newRule = await retry(() => this.client.createFirewallRule(rule), {
            maxAttempts: 3,
          })
          addedRules.push(newRule)
          logger.debug(`New custom rule added: ${newRule.id}`)
        } catch (error) {
          logger.error(`Failed to add custom rule "${rule.name}":`, error)
          errors.push(describeError(`Failed to add custom rule "${rule.name}"`, error))
        }
      }

      // Add new IP blocking rules
      for (const rule of ipRulesToAdd) {
        try {
          logger.debug(`Adding new IP blocking rule: ${rule.ip}`)
          const newIPRule = await retry(() => this.client.createIPBlockingRule(rule), {
            maxAttempts: 3,
          })
          addedIPRules.push(newIPRule)
          logger.debug(`New IP blocking rule added: (hostname): ${newIPRule.hostname} (ip): ${newIPRule.ip}`)
        } catch (error) {
          logger.error(`Failed to add IP blocking rule ${rule.ip}:`, error)
          errors.push(describeError(`Failed to add IP blocking rule ${rule.ip}`, error))
        }
      }

      // Update existing custom rules
      for (const rule of toUpdate) {
        try {
          logger.debug(`Updating custom rule: ${rule.id}`)
          const updatedRule = await retry(() => this.client.updateFirewallRule(rule), { maxAttempts: 3 })
          updatedRules.push(updatedRule)
          logger.debug(`Custom rule updated: ${updatedRule.id}`)
        } catch (error) {
          logger.error(`Failed to update custom rule ${rule.id}:`, error)
          errors.push(describeError(`Failed to update custom rule ${rule.id}`, error))
        }
      }

      // Update existing IP blocking rules
      for (const rule of ipRulesToUpdate) {
        try {
          logger.debug(`Updating IP blocking rule: ${rule.id}`)
          const updatedRule = await retry(() => this.client.updateIPBlockingRule(rule), { maxAttempts: 3 })
          updatedIPRules.push(updatedRule)
          logger.debug(`IP blocking rule updated: ${updatedRule.id}`)
        } catch (error) {
          logger.error(`Failed to update IP blocking rule ${rule.id}:`, error)
          errors.push(describeError(`Failed to update IP blocking rule ${rule.id}`, error))
        }
      }

      logger.debug(
        `${chalk.underline('Custom Rules:')} ${chalk.green('Added:')} ${chalk.green(addedRules.length)}, ` +
          `${chalk.cyan('Updated:')} ${chalk.cyan(updatedRules.length)}, ${chalk.red('Deleted:')} ${chalk.red(deletedRules.length)}`,
      )
      logger.debug(
        `${chalk.underline('IP Rules:')} ${chalk.green('Added:')} ${chalk.green(addedIPRules.length)}, ` +
          `${chalk.cyan('Updated:')} ${chalk.cyan(updatedIPRules.length)}, ${chalk.red('Deleted:')} ${chalk.red(deletedIPRules.length)}`,
      )

      // Fetch updated version. Best-effort: a failure here shouldn't
      // discard the sync results already collected above. Falls back to
      // the pre-sync version (captured before any mutations) if it fails.
      let finalVersion: number = version
      try {
        const activeConfig = await this.client.fetchFirewallConfig()
        finalVersion = activeConfig.version
      } catch (error) {
        logger.error('Failed to fetch updated firewall configuration version after sync:', error)
        errors.push(describeError('Failed to fetch updated configuration version after sync', error))
      }

      return {
        success: errors.length === 0,
        rulesAdded: addedRules.length,
        rulesUpdated: updatedRules.length,
        rulesDeleted: deletedRules.length,
        ipsAdded: addedIPRules.length,
        ipsUpdated: updatedIPRules.length,
        ipsDeleted: deletedIPRules.length,
        version: finalVersion,
        errors: errors.length > 0 ? errors : undefined,
      }
    } catch (error) {
      logger.error('Error during sync:', error)
      // Preserve the real error instead of discarding it behind a generic
      // message — callers (and anyone debugging a failed sync) need to
      // know *why* it failed, not just that it did.
      throw new Error(
        `Failed to synchronize firewall rules: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Get changes between local and remote configuration
   */
  async getChanges(
    config: UnifiedConfig,
    options?: { allowCreate?: boolean },
  ): Promise<ChangeSet & { version: number }> {
    try {
      logger.debug('Fetching existing firewall configuration')
      // `allowCreate: false` is threaded down from syncRules' dry-run path
      // so a project without a firewall config yet never triggers the
      // interactive create-prompt (or the mutating PUT behind it) while
      // we're only computing what a sync *would* do. Real (non-dry-run)
      // syncs keep the default `true`, preserving create-on-first-use.
      const activeConfig = await this.client.fetchFirewallConfig(undefined, {
        allowCreate: options?.allowCreate ?? true,
      })
      logger.debug(`Fetched ${activeConfig.rules.length} custom rules and ${activeConfig.ips.length} IP blocking rules`)

      // Convert unified rules back to Vercel format for comparison
      const configRules: CustomRule[] = config.rules.map((rule) => {
        const translation = RuleTranslator.unifiedToVercel(rule)
        if (translation.warnings.length > 0) {
          translation.warnings.forEach((w) => {
            const { TranslationWarningSystem } = require('../../translators/TranslationWarningSystem')
            const formattedWarning = TranslationWarningSystem.formatWarning(w)
            logger.warn(`Rule ${rule.name}:\n${formattedWarning}`)
          })
        }
        return translation.result
      })

      // Handle custom rules
      const { toAdd, toUpdate, toDelete } = this.diffRules(configRules, activeConfig.rules)

      // Convert unified IP rules back to Vercel format
      const configIPs: IPBlockingRule[] = (config.ips || []).map((ip) => ({
        id: ip.id || '',
        ip: ip.ip,
        hostname: ip.hostname || '',
        action: ip.action as 'deny',
        notes: ip.notes,
      }))

      // Handle IP blocking rules
      const { ipsToAdd, ipsToUpdate, ipsToDelete } = this.diffIPRules(configIPs, activeConfig.ips)

      // Convert to unified format for ChangeSet compatibility
      const unifiedRulesToAdd = toAdd.map((r) => RuleTranslator.vercelToUnified(r).result)
      const unifiedRulesToUpdate = toUpdate.map((r) => RuleTranslator.vercelToUnified(r).result)
      const unifiedRulesToDelete = toDelete.map((r) => RuleTranslator.vercelToUnified(r).result)
      const unifiedIPsToAdd = ipsToAdd.map((ip) => RuleTranslator.vercelIPToUnified(ip))
      const unifiedIPsToUpdate = ipsToUpdate.map((ip) => RuleTranslator.vercelIPToUnified(ip))
      const unifiedIPsToDelete = ipsToDelete.map((ip) => RuleTranslator.vercelIPToUnified(ip))

      return {
        version: activeConfig.version,
        rulesToAdd: unifiedRulesToAdd,
        rulesToUpdate: unifiedRulesToUpdate,
        rulesToDelete: unifiedRulesToDelete,
        ipsToAdd: unifiedIPsToAdd,
        ipsToUpdate: unifiedIPsToUpdate,
        ipsToDelete: unifiedIPsToDelete,
        hasChanges:
          toAdd.length > 0 ||
          toUpdate.length > 0 ||
          toDelete.length > 0 ||
          ipsToAdd.length > 0 ||
          ipsToUpdate.length > 0 ||
          ipsToDelete.length > 0,
      }
    } catch (error) {
      logger.error('Error fetching existing firewall configuration:', error)
      throw new Error('Failed to fetch existing firewall configuration')
    }
  }

  /**
   * Get supported features for Vercel provider
   */
  getSupportedFeatures(): FeatureSet {
    return {
      supportsCustomRules: true,
      supportsIPBlocking: true,
      supportsRateLimiting: true,
      supportsGeoBlocking: true,
      supportsManagedRules: false, // Vercel CRS is enterprise only
      supportsRedirect: true,
      supportsChallenge: true,
    }
  }

  /**
   * Verify Vercel credentials
   */
  async verifyCredentials(): Promise<boolean> {
    return this.client.verifyCredentials()
  }

  /**
   * Validate Vercel-specific configuration
   */
  public validateConfig(config: UnifiedConfig): ValidationResult {
    // First run base validation
    const baseValidation = super.validateConfig(config)

    // Add Vercel-specific validation
    const errors = [...baseValidation.errors]
    const warnings = [...baseValidation.warnings]

    // Check for Vercel-specific requirements
    if (config.provider && config.provider !== 'vercel') {
      errors.push({
        path: 'provider',
        message: `Provider must be 'vercel' for VercelFirewallService`,
        code: 'INVALID_PROVIDER',
      })
    }

    // Validate against Vercel schema if available
    try {
      const validationResult = firewallConfigSchema.safeParse(config)
      if (!validationResult.success) {
        errors.push({
          path: 'root',
          message: `Schema validation failed: ${validationResult.error.message}`,
          code: 'SCHEMA_VALIDATION_FAILED',
        })
      }
    } catch (error) {
      logger.debug('Schema validation error:', error)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Get health score with Vercel-specific checks
   */
  public getHealthScore(config: UnifiedConfig): HealthScore {
    const baseScore = super.getHealthScore(config)

    // Add Vercel-specific health checks
    const issues: HealthIssue[] = [...baseScore.issues]
    let score = baseScore.score

    // Check for rate limiting rules
    const rateLimitRules = config.rules.filter((r) => r.action?.type === 'rate_limit')
    if (rateLimitRules.length === 0) {
      score -= 10
      issues.push({
        severity: 'info',
        category: 'security',
        message: 'No rate limiting rules configured',
        suggestion: 'Consider adding rate limiting to protect against abuse',
      })
    }

    // Check for IP blocking
    if (!config.ips || config.ips.length === 0) {
      issues.push({
        severity: 'info',
        category: 'security',
        message: 'No IP blocking rules configured',
        suggestion: 'Consider blocking known malicious IPs',
      })
    }

    return {
      score: Math.max(0, score),
      grade: baseScore.grade,
      issues,
      recommendations: baseScore.recommendations,
    }
  }

  /**
   * Diff custom rules
   */
  private diffRules(
    configRules: CustomRule[],
    existingRules: CustomRule[],
  ): {
    toAdd: CustomRule[]
    toUpdate: CustomRule[]
    toDelete: CustomRule[]
  } {
    const toAdd: CustomRule[] = []
    const toUpdate: CustomRule[] = []
    const toDelete = [...existingRules]

    for (const configRule of configRules) {
      const existingRule = existingRules.find((r) => r.id === configRule.id)
      if (!existingRule) {
        toAdd.push(configRule)
      } else {
        if (!isDeepEqual(omitId(configRule), omitId(existingRule))) {
          toUpdate.push({ ...configRule, id: existingRule.id })
        }
        const deleteIndex = toDelete.findIndex((r) => r.id === existingRule.id)
        if (deleteIndex !== -1) {
          toDelete.splice(deleteIndex, 1)
        }
      }
    }

    return { toAdd, toUpdate, toDelete }
  }

  /**
   * Diff IP blocking rules
   */
  private diffIPRules(
    configRules: IPBlockingRule[],
    existingRules: IPBlockingRule[],
  ): {
    ipsToAdd: IPBlockingRule[]
    ipsToUpdate: IPBlockingRule[]
    ipsToDelete: IPBlockingRule[]
  } {
    const ipsToAdd: IPBlockingRule[] = []
    const ipsToUpdate: IPBlockingRule[] = []
    const ipsToDelete = [...existingRules]

    for (const configRule of configRules) {
      const existingRule = existingRules.find((r) => r.id === configRule.id)
      if (!existingRule) {
        logger.debug('Rule not found in existing rules:', { configRule })
        ipsToAdd.push(configRule)
      } else {
        if (!isDeepEqual(omitId(configRule), omitId(existingRule))) {
          ipsToUpdate.push({ ...existingRule, ...configRule })
        }

        const deleteIndex = ipsToDelete.findIndex((r) => r.id === existingRule.id)
        if (deleteIndex !== -1) {
          ipsToDelete.splice(deleteIndex, 1)
        }
      }
    }

    return { ipsToAdd, ipsToUpdate, ipsToDelete }
  }
}
