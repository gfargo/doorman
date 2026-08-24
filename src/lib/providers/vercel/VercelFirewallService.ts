import chalk from 'chalk'
import { logger } from '../../logger'
import { BaseFirewallService } from '../BaseFirewallService'
import { VercelClient } from './VercelClient'
import { RuleTranslator } from '../../translators'
import { isDeepEqual } from '../../utils/isDeepEqual'
import { omitId } from '../../utils/omitId'
import { firewallConfigSchema } from '../../schemas/firewallSchemas'
import { unifiedConfigSchema } from '../../schemas/unifiedSchemas'
import { hasExplicitPriorities, sortRulesByPriority } from '../../utils/sortRulesByPriority'
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
        // CloudflareFirewallService.fetchConfig already sets providers.cloudflare
        // — this must match, or downstream ValidationService checks (which
        // require providers.<provider> to be present whenever `provider` is
        // set) throw, and ProviderDetector's round-trip auto-detection breaks.
        providers: {
          vercel: {
            projectId: this.client['projectId'],
            // Omitted entirely (not set to `undefined`/`''`) when the client
            // has no explicit team ID — an unconditionally-set optional
            // field is exactly the isDeepEqual/diffing pitfall documented
            // in #199/#203.
            ...(this.client['teamId'] ? { teamId: this.client['teamId'] } : {}),
          },
        },
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

      // Ordering on Vercel is best-effort. Rules are written individually
      // (`rules.insert`/`rules.update`), not as one ordered array like
      // Cloudflare's ruleset replace — so doorman controls the order new
      // rules are appended in, but cannot move a rule that already exists
      // remotely. A config that declares priorities and still has surviving
      // pre-existing rules therefore won't end up in exactly the declared
      // order, and saying so is better than letting the user assume it did.
      // `config.rules.length > rulesToAdd.length` means at least one rule
      // already exists remotely (being updated, or unchanged) — those are
      // the ones whose position is fixed. When every rule is a fresh create,
      // insertion order fully determines evaluation order and there's
      // nothing to warn about.
      const orderingWarnings: string[] = []
      if (hasExplicitPriorities(config.rules) && config.rules.length > rulesToAdd.length) {
        orderingWarnings.push(
          'Rule `priority` is best-effort on Vercel: new rules are created in priority order, but rules that already ' +
            'exist remotely cannot be repositioned via the Vercel API. Recreate them (remove and re-add) if exact ' +
            'evaluation order matters.',
        )
      }

      // Vercel always assigns its own id on create (createFirewallRule sends
      // `id: null` regardless of what the local rule had, if anything) — so
      // the local config's rule id is essentially always stale for a newly
      // created rule. This is real reconciliation data, not a naming-
      // convention guess: `oldId` is the local rule's id if it had one (a
      // caller should match on it), otherwise omitted (match on `name`).
      const idRemappings: NonNullable<SyncResult['idRemappings']> = []

      // Delete custom rules
      for (const rule of toDelete) {
        try {
          logger.debug(`Deleting custom rule: ${rule.id}`)
          await this.client.deleteFirewallRule(rule)
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
          await this.client.deleteIPBlockingRule(rule)
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
          const newRule = await this.client.createFirewallRule(rule)
          addedRules.push(newRule)
          if (newRule.id && newRule.id !== rule.id) {
            idRemappings.push({ oldId: rule.id || undefined, newId: newRule.id, name: rule.name })
          }
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
          const newIPRule = await this.client.createIPBlockingRule(rule)
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
          const updatedRule = await this.client.updateFirewallRule(rule)
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
          const updatedRule = await this.client.updateIPBlockingRule(rule)
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

      // Fetch updated version/timestamp, and use the same re-fetch to
      // spot-check that the mutations above actually landed. This is
      // deliberately lightweight (presence/absence by id, not a full
      // content comparison) — it's meant to catch a create/update/delete
      // that silently didn't take effect (API eventual consistency, a
      // partial failure not caught by the per-item try/catch above, etc),
      // not to replace the per-item error handling. Mismatches are
      // reported as warnings, not failures — the sync itself already
      // succeeded from the API's point of view.
      let finalVersion: number = version
      let finalUpdatedAt: string | undefined
      const warnings: string[] = [...orderingWarnings]
      try {
        const activeConfig = await this.client.fetchFirewallConfig()
        finalVersion = activeConfig.version
        finalUpdatedAt = activeConfig.updatedAt

        const remoteRuleIds = new Set(activeConfig.rules.map((r) => r.id))
        const remoteIPIds = new Set(activeConfig.ips.map((r) => r.id))

        for (const rule of [...addedRules, ...updatedRules]) {
          if (rule.id && !remoteRuleIds.has(rule.id)) {
            warnings.push(
              `Rule "${rule.name}" (${rule.id}) was synced but is missing from the post-sync remote config — a subsequent sync may re-create or misdiff it.`,
            )
          }
        }
        for (const rule of deletedRules) {
          if (rule.id && remoteRuleIds.has(rule.id)) {
            warnings.push(
              `Rule "${rule.name}" (${rule.id}) was deleted but still appears in the post-sync remote config.`,
            )
          }
        }
        for (const ip of [...addedIPRules, ...updatedIPRules]) {
          if (ip.id && !remoteIPIds.has(ip.id)) {
            warnings.push(
              `IP rule "${ip.ip}" (${ip.id}) was synced but is missing from the post-sync remote config — a subsequent sync may re-create or misdiff it.`,
            )
          }
        }
        for (const ip of deletedIPRules) {
          if (ip.id && remoteIPIds.has(ip.id)) {
            warnings.push(`IP rule "${ip.ip}" (${ip.id}) was deleted but still appears in the post-sync remote config.`)
          }
        }
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
        updatedAt: finalUpdatedAt,
        idRemappings: idRemappings.length > 0 ? idRemappings : undefined,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
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
    // Reject a structurally invalid config up front — before ever diffing
    // or contacting the API — rather than letting a rule with no
    // conditions, or an IP rule with a malformed address, silently reach
    // Vercel. Uses the schema directly rather than `validateUnifiedConfig`,
    // which also asserts `providers.<provider>` is present — a routing
    // concern already enforced earlier in the command pipeline, not
    // something a diff/sync call needs to re-check on every invocation.
    // Deliberately outside the try/catch below so this specific failure
    // surfaces with its own message instead of being flattened into the
    // generic "failed to fetch" one.
    const configValidation = unifiedConfigSchema.safeParse(config)
    if (!configValidation.success) {
      throw new Error(`Invalid firewall configuration: ${configValidation.error.message}`)
    }
    this.assertManagedRulesSupported(config)

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

      // Diff in unified space, normalizing BOTH sides through
      // `vercelToUnified` rather than translating only the local config to
      // Vercel shape and comparing it against the raw remote response.
      // Translating one side but not the other is asymmetric: `unifiedToVercel`
      // fills in fields a minimal on-disk config never had (e.g.
      // action.mitigate.rateLimit/redirect/actionDuration defaulting to
      // null), which then never structurally matches a remote rule that
      // omits them — producing a spurious "update" on every sync even when
      // nothing actually changed.
      const remoteRules: UnifiedRule[] = activeConfig.rules.map((rule) => {
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

      // Handle custom rules. Sorted by `priority` first so `toAdd` comes out
      // in the intended evaluation order — Vercel creates rules one at a
      // time via `rules.insert`, so insertion order is the only ordering
      // lever available here. See syncRules for why that's best-effort
      // rather than a guarantee.
      //
      // Diff against `configValidation.data`, not the raw `config` param —
      // `diffRules`/`diffIPRules` both require already-normalized input (see
      // their docstrings), but the raw config a user writes by hand is
      // allowed to omit fields the schema defaults for them (e.g. a rule's
      // `conditionLogic`). Reading from the unparsed `config` silently
      // violated that contract: a local rule relying on the documented
      // default had one fewer key than the always-explicit translated
      // remote side, so `isDeepEqual` (which compares key count) flagged it
      // as a phantom "update" forever. See #225.
      const { toAdd, toUpdate, toDelete } = this.diffRules(
        sortRulesByPriority(configValidation.data.rules),
        remoteRules,
      )

      const remoteIPs: UnifiedIPRule[] = activeConfig.ips.map((ip) => RuleTranslator.vercelIPToUnified(ip))

      // Handle IP blocking rules
      const { ipsToAdd, ipsToUpdate, ipsToDelete } = this.diffIPRules(configValidation.data.ips || [], remoteIPs)

      return {
        version: activeConfig.version,
        rulesToAdd: toAdd,
        rulesToUpdate: toUpdate,
        rulesToDelete: toDelete,
        ipsToAdd,
        ipsToUpdate,
        ipsToDelete,
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
   * Diff custom rules. Both arguments must already be normalized into
   * `UnifiedRule` — see the comment in `getChanges` for why comparing an
   * unnormalized side against a normalized one produces false diffs.
   */
  private diffRules(
    configRules: UnifiedRule[],
    existingRules: UnifiedRule[],
  ): {
    toAdd: UnifiedRule[]
    toUpdate: UnifiedRule[]
    toDelete: UnifiedRule[]
  } {
    const toAdd: UnifiedRule[] = []
    const toUpdate: UnifiedRule[] = []
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
   * Diff IP blocking rules. Both arguments must already be normalized into
   * `UnifiedIPRule` — see the comment in `getChanges`.
   */
  private diffIPRules(
    configRules: UnifiedIPRule[],
    existingRules: UnifiedIPRule[],
  ): {
    ipsToAdd: UnifiedIPRule[]
    ipsToUpdate: UnifiedIPRule[]
    ipsToDelete: UnifiedIPRule[]
  } {
    const ipsToAdd: UnifiedIPRule[] = []
    const ipsToUpdate: UnifiedIPRule[] = []
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
