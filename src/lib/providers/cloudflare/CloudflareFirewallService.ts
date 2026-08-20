import { isIPv4, isIPv6 } from 'net'
import { BaseFirewallService } from '../BaseFirewallService'
import { CloudflareClient } from './CloudflareClient'
import { CloudflareOptimizer } from './CloudflareOptimizer'
import { RuleTranslator } from '../../translators/RuleTranslator'
import { logger } from '../../logger'
import { CloudflareErrorHandler } from './CloudflareErrorHandler'
import { cloudflareErrors } from '../../errors'
import type { ProviderType, SyncOptions, SyncResult, ChangeSet, FeatureSet, HealthScore } from '../IFirewallProvider'
import type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from '../../types/unified'
import type { CloudflareRule } from '../../types/cloudflare'
// CloudflareRuleset imported for future caching use
// import type { CloudflareRuleset } from '../../types/cloudflare'

/**
 * Cloudflare Firewall Service
 * Implements IFirewallProvider for Cloudflare WAF
 */
export class CloudflareFirewallService extends BaseFirewallService {
  public readonly name: ProviderType = 'cloudflare'
  private client: CloudflareClient
  private optimizer: CloudflareOptimizer
  // Cached for potential future use
  // private _currentRuleset?: CloudflareRuleset
  // private _ipBlocklistId?: string
  private useListsForIPs: boolean

  constructor(apiToken: string, zoneId: string, accountId?: string) {
    super()
    this.client = new CloudflareClient(apiToken, zoneId, accountId)
    this.optimizer = this.client.getOptimizer()
    // Use Lists for IP blocking if accountId is provided
    this.useListsForIPs = !!accountId

    // Log Lists API availability status
    if (this.useListsForIPs) {
      logger.debug('Lists API enabled for IP blocking (account ID provided)')
    } else {
      logger.debug('Lists API disabled - will use individual IP rules (no account ID)')
    }
  }

  /**
   * Fetch current configuration from Cloudflare
   */
  public async fetchConfig(_version?: number): Promise<UnifiedConfig> {
    logger.info('Fetching configuration from Cloudflare')

    try {
      // Get or create custom firewall ruleset
      const ruleset = await this.client.getOrCreateFirewallRuleset()
      // Cache for potential future use
      // this._currentRuleset = ruleset

      // Convert Cloudflare rules to unified format
      const rules: UnifiedRule[] = []
      const ips: UnifiedIPRule[] = []
      const translationWarnings: string[] = []
      const processingErrors: string[] = []

      // Process rules in batches to prevent memory issues with large rule sets
      const batchSize = 50
      const totalRules = ruleset.rules.length

      if (totalRules > 100) {
        logger.info(`Processing ${totalRules} rules in batches of ${batchSize} to optimize memory usage`)
      }

      for (let i = 0; i < totalRules; i += batchSize) {
        const batch = ruleset.rules.slice(i, i + batchSize)
        logger.debug(
          `Processing rules batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(totalRules / batchSize)} (${batch.length} rules)`,
        )

        for (const rule of batch) {
          try {
            // Validate rule structure before processing
            if (!rule || typeof rule !== 'object') {
              processingErrors.push(`Skipped malformed rule at index ${i}: not an object`)
              continue
            }

            if (!rule.id || !rule.expression || !rule.action) {
              processingErrors.push(
                `Skipped rule with missing required fields: ${JSON.stringify({ id: rule.id, expression: !!rule.expression, action: rule.action })}`,
              )
              continue
            }

            // Skip List-based IP rules (we'll fetch those separately)
            if (this.isListBasedIPRule(rule)) {
              continue
            }

            // Check if it's a simple IP blocking rule (individual IP rule)
            if (this.isIPBlockingRule(rule)) {
              const ipRule = this.cloudflareRuleToIPRule(rule)
              ips.push(ipRule)
            } else {
              const translation = RuleTranslator.cloudflareToUnified(rule)
              rules.push(translation.result)

              if (translation.warnings.length > 0) {
                translation.warnings.forEach((w) => {
                  const { TranslationWarningSystem } = require('../../translators/TranslationWarningSystem')
                  const formattedWarning = TranslationWarningSystem.formatWarning(w)
                  translationWarnings.push(formattedWarning)
                })
              }
            }
          } catch (ruleError) {
            const errorMessage = `Failed to process rule ${rule?.id || 'unknown'}: ${ruleError instanceof Error ? ruleError.message : String(ruleError)}`
            logger.warn(errorMessage)
            processingErrors.push(errorMessage)
            // Continue processing other rules
          }
        }

        // Add small delay between batches for large rule sets to prevent overwhelming the system
        if (totalRules > 200 && i + batchSize < totalRules) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }

      // Report processing errors if any
      if (processingErrors.length > 0) {
        logger.warn(`Encountered ${processingErrors.length} rule processing errors:`)
        processingErrors.slice(0, 5).forEach((error) => logger.warn(`  - ${error}`))
        if (processingErrors.length > 5) {
          logger.warn(`  ... and ${processingErrors.length - 5} more errors`)
        }
      }

      // Fetch IPs from List if using Lists
      if (this.useListsForIPs) {
        try {
          const ipList = await this.client.getOrCreateIPBlocklist()
          // Cache for potential future use
          // this._ipBlocklistId = ipList.id

          const listItems = await this.client.getListItems(ipList.id)
          for (const item of listItems) {
            if (item.ip) {
              ips.push({
                id: item.id,
                ip: item.ip,
                notes: item.comment,
                action: 'deny', // Lists are for blocking
              })
            }
          }

          logger.debug(`Fetched ${listItems.length} IPs from List`)
        } catch (error) {
          // Enhanced error handling for Lists API with graceful degradation
          this.handleListsAPIFallback(error, 'fetching IPs from List')
          // Continue without List IPs - this is expected behavior when Lists aren't available
        }
      } else {
        // Provide guidance when Lists API is not available
        if (ips.length > 10) {
          logger.warn(
            `⚠️  Large IP list detected (${ips.length} IPs) without Lists API. ` +
              'Consider providing CLOUDFLARE_ACCOUNT_ID for better performance.',
          )
        }
      }

      if (translationWarnings.length > 0) {
        logger.warn('Translation warnings detected:')
        translationWarnings.forEach((warning) => logger.warn(warning))

        // Show warning summary if there are multiple warnings
        if (translationWarnings.length > 3) {
          logger.warn(
            `\n📊 Summary: ${translationWarnings.length} translation warnings detected. Review each warning above for specific guidance.`,
          )
        }
      }

      return {
        version: '2.0',
        provider: 'cloudflare',
        providers: {
          cloudflare: {
            zoneId: this.client['zoneId'],
            accountId: this.client['accountId'],
          },
        },
        rules,
        ips,
        metadata: {
          version: parseInt(ruleset.version, 10),
          updatedAt: ruleset.last_updated,
        },
      }
    } catch (error) {
      if (error instanceof Error && !('code' in error)) {
        throw CloudflareErrorHandler.handleNetworkError(error, 'fetching configuration')
      }
      throw error
    }
  }

  /**
   * Sync local configuration to Cloudflare
   */
  public async syncRules(config: UnifiedConfig, options?: SyncOptions): Promise<SyncResult> {
    logger.info(`Syncing ${config.rules.length} rules to Cloudflare${options?.dryRun ? ' (dry run)' : ''}`)

    // Import operation safety utilities
    const { OperationSafety } = require('../../utils/operationSafety')

    // Perform dry-run validation first
    const dryRunResult = await OperationSafety.performDryRunValidation(
      config,
      'sync rules',
      async (cfg: UnifiedConfig) => await this.getChanges(cfg),
    )

    if (!dryRunResult.valid) {
      throw new Error(`Dry-run validation failed: ${dryRunResult.issues.join(', ')}`)
    }

    if (options?.dryRun) {
      return {
        success: true,
        rulesAdded: dryRunResult.changes.rulesToAdd.length,
        rulesUpdated: dryRunResult.changes.rulesToUpdate.length,
        rulesDeleted: dryRunResult.changes.rulesToDelete.length,
        ipsAdded: dryRunResult.changes.ipsToAdd?.length || 0,
        ipsUpdated: dryRunResult.changes.ipsToUpdate?.length || 0,
        ipsDeleted: dryRunResult.changes.ipsToDelete?.length || 0,
        warnings: dryRunResult.warnings,
      }
    }

    // Determine risk level based on changes
    const riskLevel = OperationSafety.assessOperationRisk(dryRunResult.changes, config)

    // Get user confirmation for destructive operations
    const confirmed = await OperationSafety.confirmDestructiveOperation({
      operation: 'sync rules',
      target: `Cloudflare zone ${this.client['zoneId']}`,
      changes: dryRunResult.changes,
      riskLevel,
      skipConfirmation: options?.force || false,
      dryRun: options?.dryRun || false,
      allowDeletions: options?.allowDeletions || false,
    })

    if (!confirmed) {
      throw new Error('Operation cancelled by user')
    }

    // Get or create ruleset
    const ruleset = await this.client.getOrCreateFirewallRuleset()
    // Cache for potential future use
    // this._currentRuleset = ruleset

    // Translate all rules to Cloudflare format
    const cloudflareRules: CloudflareRule[] = []

    // Add regular rules
    for (const rule of config.rules) {
      const translation = RuleTranslator.unifiedToCloudflare(rule)
      cloudflareRules.push(translation.result)

      if (translation.warnings.length > 0) {
        translation.warnings.forEach((w) => {
          const { TranslationWarningSystem } = require('../../translators/TranslationWarningSystem')
          const formattedWarning = TranslationWarningSystem.formatWarning(w)
          logger.warn(formattedWarning)
        })
      }
    }

    // Handle IP blocking
    let ipsAdded = 0
    const ipsUpdated = 0
    let ipsDeleted = 0

    if (this.useListsForIPs && config.ips && config.ips.length > 0) {
      // Use Lists for IP blocking. Tracks which IPs are confirmed present in
      // the List as each step actually completes, so a failure *partway*
      // through (e.g. addListItems succeeds but a later step throws) doesn't
      // fall back to creating individual rules for IPs that already made it
      // into the List — that would leave them in both places (duplicate,
      // inconsistent state) and double-count them in ipsAdded.
      const confirmedInList = new Set<string>()
      try {
        const ipList = await this.client.getOrCreateIPBlocklist()
        // Cache for potential future use
        // this._ipBlocklistId = ipList.id

        // Get current IPs in list
        const currentItems = await this.client.getListItems(ipList.id)
        const currentIPs = new Set(currentItems.map((item) => item.ip))
        currentIPs.forEach((ip) => ip && confirmedInList.add(ip))
        const desiredIPs = new Set(config.ips.map((ip) => ip.ip))

        // Add new IPs
        const ipsToAdd = config.ips.filter((ip) => !currentIPs.has(ip.ip))
        if (ipsToAdd.length > 0) {
          await this.client.addListItems(ipList.id, {
            items: ipsToAdd.map((ip) => ({
              ip: ip.ip,
              comment: ip.notes || ip.hostname || `Blocked by Doorman`,
            })),
          })
          ipsAdded = ipsToAdd.length
          ipsToAdd.forEach((ip) => confirmedInList.add(ip.ip))
          logger.info(`Added ${ipsAdded} IPs to List`)
        }

        // Remove IPs no longer in config
        const ipsToRemove = currentItems.filter((item) => item.ip && !desiredIPs.has(item.ip))
        if (ipsToRemove.length > 0) {
          await this.client.removeListItems(ipList.id, {
            items: ipsToRemove.map((item) => ({ id: item.id! })),
          })
          ipsDeleted = ipsToRemove.length
          ipsToRemove.forEach((item) => item.ip && confirmedInList.delete(item.ip))
          logger.info(`Removed ${ipsDeleted} IPs from List`)
        }

        // Ensure a rule blocking IPs in the list is present in this sync's
        // ruleset payload. `cloudflareRules` is rebuilt from scratch every
        // sync (the whole ruleset is replaced in one PUT below), so checking
        // the *previous* ruleset's rules for this — `ruleset.rules.some(...)`
        // — was wrong: once sync #1 added the list rule, sync #2 would see it
        // "already there" in that stale pre-sync snapshot and omit it from
        // the new array, silently overwriting the ruleset without it. The
        // List itself stayed populated, so IP blocking went dark with no
        // error. There's nothing to append to here — `cloudflareRules` is a
        // fresh array — so always including it once has no duplication risk.
        const listRuleExpression = `ip.src in $${ipList.name.replace(/\s+/g, '_').toLowerCase()}`
        cloudflareRules.push({
          id: `rule_doorman_ip_list`,
          action: 'block',
          expression: listRuleExpression,
          description: 'Block IPs in Doorman IP Blocklist',
          enabled: true,
        })
      } catch (error) {
        // Enhanced fallback handling with detailed messaging
        this.handleListsAPIFallback(error, 'syncing IPs via List')

        // Only fall back to individual rules for IPs not already confirmed
        // committed to the List by the time the failure happened.
        const ipsNeedingFallback = config.ips.filter((ip) => !confirmedInList.has(ip.ip))

        if (ipsNeedingFallback.length > 0) {
          logger.info(`🔄 Falling back to individual IP rules for ${ipsNeedingFallback.length} IPs`)
          for (const ip of ipsNeedingFallback) {
            const cloudflareRule = RuleTranslator.unifiedIPToCloudflare(ip)
            cloudflareRules.push(cloudflareRule)
          }
          ipsAdded = ipsNeedingFallback.length
        } else {
          logger.info('All IPs were already confirmed in the List before the failure; no fallback rules needed.')
        }

        // Warn about performance impact for large lists
        if (ipsNeedingFallback.length > 50) {
          logger.warn(
            `⚠️  Performance warning: Using ${ipsNeedingFallback.length} individual IP rules instead of Lists. ` +
              'This may impact rule processing speed and count against your rule limit.',
          )
        }
      }
    } else if (config.ips && config.ips.length > 0) {
      // Use individual IP rules (no accountId provided or Lists disabled)
      logger.info(`📝 Using individual IP rules for ${config.ips.length} IPs (Lists API not available)`)

      // Warn about large IP lists without Lists API
      if (config.ips.length > 20) {
        logger.warn(
          `⚠️  Large IP list detected (${config.ips.length} IPs) without Lists API. ` +
            'Consider providing CLOUDFLARE_ACCOUNT_ID for better performance and rule efficiency.',
        )
      }

      for (const ip of config.ips) {
        const cloudflareRule = RuleTranslator.unifiedIPToCloudflare(ip)
        cloudflareRules.push(cloudflareRule)
      }
      ipsAdded = config.ips.length
    }

    // Update entire ruleset with new rules
    const updatedRuleset = await this.client.updateRuleset(ruleset.id, {
      rules: cloudflareRules,
    })

    const result: SyncResult = {
      success: true,
      // The actual write below is a full-ruleset replace, not incremental
      // add/update/delete calls — these counts come from the pre-sync diff
      // (now accurate, see getChanges) rather than reflecting the mechanics
      // of the write itself. Previously this always reported
      // `rulesAdded: config.rules.length, rulesUpdated: 0, rulesDeleted: 0`
      // regardless of what actually changed, which could flatly contradict
      // the "Proposed Changes" preview shown moments earlier from the same
      // diff.
      rulesAdded: dryRunResult.changes.rulesToAdd.length,
      rulesUpdated: dryRunResult.changes.rulesToUpdate.length,
      rulesDeleted: dryRunResult.changes.rulesToDelete.length,
      ipsAdded,
      ipsUpdated,
      ipsDeleted,
      version: parseInt(updatedRuleset.version, 10),
      warnings: dryRunResult.warnings?.length ? dryRunResult.warnings : undefined,
    }

    this.logSyncStats(result)
    return result
  }

  /**
   * Get changes between local and remote configurations.
   *
   * Diffs rules in Cloudflare's *native* space (real wirefilter expressions)
   * rather than going through `fetchConfig()`'s Unified translation. Even
   * though `cloudflareToUnified` now parses expressions back into real
   * conditions (via `WirefilterParser`) for hand-authored or foreign
   * expressions outside the grammar subset it understands, that translation
   * still isn't guaranteed lossless — diffing in native space avoids any
   * risk of a remote rule failing to diff-equal its local counterpart due
   * to a translation gap, which previously showed every synced rule as
   * `toUpdate` forever, even on a no-op sync. See
   * `CloudflareOptimizer.diffCloudflareRules`.
   */
  public async getChanges(config: UnifiedConfig): Promise<ChangeSet> {
    const ruleset = await this.client.getOrCreateFirewallRuleset()

    const remoteCloudflareRules = ruleset.rules.filter(
      (r) => r && r.id && r.expression && r.action && !this.isListBasedIPRule(r) && !this.isIPBlockingRule(r),
    )

    const localTranslations = config.rules.map((rule) => ({
      rule,
      translated: RuleTranslator.unifiedToCloudflare(rule).result,
    }))

    const ruleDiff = this.optimizer.diffCloudflareRules(localTranslations, remoteCloudflareRules)
    // No local counterpart for a remote-only rule — best-effort translation
    // back to Unified is fine for a delete preview, which only needs to
    // identify *what* is being removed, not perfectly round-trip it.
    const rulesToDelete = ruleDiff.toDelete.map((r) => RuleTranslator.cloudflareToUnified(r).result)

    // IP diffing is unaffected by the above: it round-trips losslessly
    // already (only `ip`/`action` are ever compared).
    let ipDiff: { toAdd: UnifiedIPRule[]; toUpdate: UnifiedIPRule[]; toDelete: UnifiedIPRule[] } = {
      toAdd: [],
      toUpdate: [],
      toDelete: [],
    }
    if (config.ips) {
      const remoteIPs = await this.fetchRemoteIPRulesForDiff(ruleset.rules)
      ipDiff = this.optimizer.diffIPRules(config.ips, remoteIPs)
    }

    return {
      rulesToAdd: ruleDiff.toAdd,
      rulesToUpdate: ruleDiff.toUpdate,
      rulesToDelete,
      ipsToAdd: ipDiff.toAdd,
      ipsToUpdate: ipDiff.toUpdate,
      ipsToDelete: ipDiff.toDelete,
      version: parseInt(ruleset.version, 10),
      hasChanges:
        ruleDiff.toAdd.length > 0 ||
        ruleDiff.toUpdate.length > 0 ||
        rulesToDelete.length > 0 ||
        ipDiff.toAdd.length > 0 ||
        ipDiff.toUpdate.length > 0 ||
        ipDiff.toDelete.length > 0,
    }
  }

  /**
   * Fetch the current IP blocking state directly from the ruleset's simple
   * IP rules plus (if enabled) the Lists API, without going through
   * `fetchConfig()`'s full Unified rule translation — `getChanges()` only
   * needs IP state, and reusing `fetchConfig()` here would redo the very
   * rule translation this method exists to avoid. IP rules round-trip
   * losslessly already (only `ip`/`action` matter), so this duplicates a
   * small amount of `fetchConfig()`'s IP-gathering logic rather than sharing
   * it, to avoid touching that well-covered method's rule-processing loop.
   */
  private async fetchRemoteIPRulesForDiff(rulesetRules: CloudflareRule[]): Promise<UnifiedIPRule[]> {
    const ips: UnifiedIPRule[] = []

    for (const rule of rulesetRules) {
      if (rule && rule.id && rule.expression && rule.action && this.isIPBlockingRule(rule)) {
        ips.push(this.cloudflareRuleToIPRule(rule))
      }
    }

    if (this.useListsForIPs) {
      try {
        const ipList = await this.client.getOrCreateIPBlocklist()
        const listItems = await this.client.getListItems(ipList.id)
        for (const item of listItems) {
          if (item.ip) {
            ips.push({
              id: item.id,
              ip: item.ip,
              notes: item.comment,
              action: 'deny',
            })
          }
        }
      } catch (error) {
        this.handleListsAPIFallback(error, 'fetching IPs from List')
      }
    }

    return ips
  }

  /**
   * Get supported features for Cloudflare
   */
  public getSupportedFeatures(): FeatureSet {
    return {
      supportsCustomRules: true,
      supportsIPBlocking: true,
      supportsRateLimiting: true,
      supportsManagedRules: true,
      supportsGeoBlocking: true,
      supportsRedirect: true,
      supportsChallenge: true,
      maxRules: 125, // Cloudflare Free: 5, Pro: 20, Business: 100, Enterprise: unlimited (we use 125 as reasonable default)
    }
  }

  /**
   * Validate configuration with Cloudflare-specific rules
   */
  public validateConfig(config: UnifiedConfig): import('../IFirewallProvider').ValidationResult {
    const baseResult = super.validateConfig(config)
    const errors = [...baseResult.errors]
    const warnings = [...baseResult.warnings]

    // Cloudflare-specific validations
    if (config && config.rules) {
      // Check rule count against Cloudflare limits
      const features = this.getSupportedFeatures()
      if (features.maxRules && config.rules.length > features.maxRules) {
        const error = cloudflareErrors.ruleLimitExceeded(config.rules.length, features.maxRules)
        errors.push({
          path: 'rules',
          message: error.message,
          code: error.code,
        })
      }

      // Validate each rule
      config.rules.forEach((rule, index) => {
        try {
          // Check for conditions (Cloudflare requires expressions)
          if (!rule.conditions || rule.conditions.length === 0) {
            const error = cloudflareErrors.ruleNoConditions(rule.name || `Rule ${index + 1}`)
            errors.push({
              path: `rules[${index}]`,
              message: error.message,
              code: error.code,
            })
          }

          // Validate rate limiting configuration
          if (rule.action.type === 'rate_limit' && rule.action.rateLimit) {
            const rateLimit = rule.action.rateLimit

            // Check requests per period
            if (rateLimit.requests < 1) {
              const error = cloudflareErrors.invalidRateLimit(
                rule.name || `Rule ${index + 1}`,
                'requests must be at least 1',
              )
              errors.push({
                path: `rules[${index}].action.rateLimit.requests`,
                message: error.message,
                code: error.code,
              })
            }

            // Check period format
            if (!rateLimit.window.match(/^\d+[smhd]$/)) {
              const error = cloudflareErrors.invalidWindowFormat(rateLimit.window)
              errors.push({
                path: `rules[${index}].action.rateLimit.window`,
                message: error.message,
                code: error.code,
              })
            }

            // Validate characteristics
            if (rateLimit.characteristics && rateLimit.characteristics.length === 0) {
              const error = cloudflareErrors.emptyCharacteristics(rule.name || `Rule ${index + 1}`)
              warnings.push({
                path: `rules[${index}].action.rateLimit.characteristics`,
                message: error.message,
                code: error.code,
              })
            }

            // Validate mitigation timeout
            if (rateLimit.mitigationTimeout !== undefined && rateLimit.mitigationTimeout < 60) {
              const error = cloudflareErrors.shortMitigationTimeout(rateLimit.mitigationTimeout)
              warnings.push({
                path: `rules[${index}].action.rateLimit.mitigationTimeout`,
                message: error.message,
                code: error.code,
              })
            }
          }

          // Validate redirect configuration
          if (rule.action.type === 'redirect' && rule.action.redirect) {
            const redirect = rule.action.redirect

            if (!redirect.location) {
              const error = cloudflareErrors.redirectNoLocation(rule.name || `Rule ${index + 1}`)
              errors.push({
                path: `rules[${index}].action.redirect.location`,
                message: error.message,
                code: error.code,
              })
            } else {
              // Basic URL validation
              try {
                new URL(redirect.location)
              } catch {
                // Check if it's a relative path
                if (!redirect.location.startsWith('/')) {
                  const error = cloudflareErrors.invalidRedirectUrl(redirect.location)
                  errors.push({
                    path: `rules[${index}].action.redirect.location`,
                    message: error.message,
                    code: error.code,
                  })
                }
              }
            }
          }
        } catch (validationError) {
          // Handle any unexpected validation errors
          errors.push({
            path: `rules[${index}]`,
            message: `Validation error: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
            code: 'CLOUDFLARE_VALIDATION_ERROR',
          })
        }
      })

      // Validate IP rules
      if (config.ips) {
        config.ips.forEach((ip, index) => {
          try {
            if (!CloudflareFirewallService.isValidIPOrCIDR(ip.ip)) {
              const error = cloudflareErrors.invalidIP(ip.ip)
              errors.push({
                path: `ips[${index}].ip`,
                message: error.message,
                code: error.code,
              })
            }
          } catch (validationError) {
            errors.push({
              path: `ips[${index}]`,
              message: `IP validation error: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
              code: 'CLOUDFLARE_IP_VALIDATION_ERROR',
            })
          }
        })

        // Warn about large IP lists without accountId
        if (!this.useListsForIPs && config.ips.length > 50) {
          const error = cloudflareErrors.largeIPList(config.ips.length)
          warnings.push({
            path: 'ips',
            message: error.message,
            code: error.code,
          })
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Get health score for configuration
   */
  public getHealthScore(config: UnifiedConfig): HealthScore {
    const baseScore = super.getHealthScore(config)

    // Cloudflare-specific health checks
    const issues = [...baseScore.issues]

    // Check rule count against limit
    const features = this.getSupportedFeatures()
    if (features.maxRules && config.rules.length > features.maxRules * 0.8) {
      issues.push({
        severity: 'warning',
        category: 'limits',
        message: `Approaching Cloudflare rule limit (${config.rules.length}/${features.maxRules})`,
        suggestion: 'Consider consolidating rules or upgrading plan',
      })
    }

    return {
      ...baseScore,
      issues,
    }
  }

  /**
   * Verify Cloudflare credentials
   */
  public async verifyCredentials(): Promise<boolean> {
    return this.client.verifyCredentials()
  }

  /**
   * Get cache statistics for performance monitoring
   */
  public getCacheStats(): import('../../utils/cache').CacheStats {
    return this.client.getCacheStats()
  }

  /**
   * Get optimizer statistics for performance monitoring
   */
  public getOptimizerStats(): import('./CloudflareOptimizer').OptimizerStats {
    return this.optimizer.getStats()
  }

  /**
   * Clear all cached API responses
   */
  public clearCache(): void {
    this.client.clearCache()
    this.optimizer.clearCaches()
  }

  /**
   * Validate an IP address or CIDR range, IPv4 or IPv6. Cloudflare's IP
   * blocking/Lists API supports both address families, so validation here
   * must too — a plain IPv4-only regex rejects legitimate IPv6 configs
   * outright.
   */
  private static isValidIPOrCIDR(value: string): boolean {
    const [address, prefix, ...rest] = value.split('/')
    if (rest.length > 0 || !address) {
      return false
    }

    if (prefix === undefined) {
      return isIPv4(address) || isIPv6(address)
    }

    if (!/^\d+$/.test(prefix)) {
      return false
    }
    const prefixLength = Number(prefix)

    if (isIPv4(address)) {
      return prefixLength <= 32
    }
    if (isIPv6(address)) {
      return prefixLength <= 128
    }
    return false
  }

  /**
   * Check if a Cloudflare rule is a List-based IP blocking rule
   */
  private isListBasedIPRule(rule: CloudflareRule): boolean {
    // Check if expression uses List syntax (ip.src in $list_name)
    return /ip\.src in \$/.test(rule.expression.trim())
  }

  /**
   * Check if a Cloudflare rule is a simple IP blocking rule. Covers both
   * forms `unifiedIPToCloudflare` emits: `ip.src eq <ip>` for a single
   * IPv4/IPv6 address, and `ip.src in {<cidr>}` for a CIDR range (wirefilter's
   * `eq` only matches a single literal, so CIDR ranges use the `in` set
   * operator instead). The address pattern allows IPv4 dotted-decimal and
   * IPv6 hex/colon forms.
   *
   * Also requires the rule's action to be one `unifiedIPToCloudflare` could
   * actually have produced (`block`/`allow`) — without this, any rule from
   * another tool (or hand-crafted) that happens to match the expression
   * shape but uses a different action (e.g. `challenge`/`log` a single IP)
   * gets misclassified as an IP rule, and `cloudflareRuleToIPRule` below
   * collapses that real action down to a plain allow/deny, silently
   * changing what the rule does on the next sync.
   */
  private isIPBlockingRule(rule: CloudflareRule): boolean {
    if (rule.action !== 'block' && rule.action !== 'allow') {
      return false
    }
    const expression = rule.expression.trim()
    return (
      CloudflareFirewallService.IP_EQ_PATTERN.test(expression) ||
      CloudflareFirewallService.IP_IN_SET_PATTERN.test(expression)
    )
  }

  private static readonly IP_EQ_PATTERN = /^ip\.src eq ([0-9a-fA-F:.]+)$/
  private static readonly IP_IN_SET_PATTERN = /^ip\.src in \{([0-9a-fA-F:./]+)\}$/

  /**
   * Convert Cloudflare rule to IP rule
   */
  private cloudflareRuleToIPRule(rule: CloudflareRule): UnifiedIPRule {
    const expression = rule.expression.trim()
    const match =
      expression.match(CloudflareFirewallService.IP_EQ_PATTERN) ||
      expression.match(CloudflareFirewallService.IP_IN_SET_PATTERN)
    const ip = match?.[1] || ''

    // Extract hostname from description if present
    const hostnameMatch = rule.description?.match(/\(([^)]+)\)/)
    const hostname = hostnameMatch?.[1]

    return {
      id: rule.id,
      ip,
      hostname,
      notes: rule.description,
      action: rule.action === 'allow' ? 'allow' : 'deny',
    }
  }

  /**
   * Handle Lists API fallback scenarios with clear messaging and guidance
   */
  private handleListsAPIFallback(error: unknown, operation: string): void {
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase()

      if (errorMessage.includes('account')) {
        logger.warn(
          `🚫 Lists API unavailable: Account ID not provided or invalid. ` + 'Falling back to individual IP rules.',
        )
        logger.info(
          `💡 To enable Lists API for better performance with large IP lists:\n` +
            `   • Set CLOUDFLARE_ACCOUNT_ID in your environment\n` +
            `   • Ensure your API token has Account:Read permissions\n` +
            `   • Find your Account ID in the Cloudflare dashboard sidebar`,
        )
      } else if (errorMessage.includes('permission') || errorMessage.includes('forbidden')) {
        logger.warn(
          `🚫 Lists API permission denied: Insufficient permissions for ${operation}. ` +
            'Falling back to individual IP rules.',
        )
        logger.info(
          `💡 To fix Lists API permissions:\n` +
            `   • Ensure your API token has Account:Read permissions\n` +
            `   • Verify the account ID is correct\n` +
            `   • Check token permissions in Cloudflare dashboard`,
        )
      } else if (errorMessage.includes('not found')) {
        logger.warn(`🚫 Lists API resource not found during ${operation}. ` + 'Falling back to individual IP rules.')
        logger.info(`💡 This may be temporary - the List will be recreated on next sync if Lists API is available.`)
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
        logger.warn(`🚫 Lists API rate limited during ${operation}. ` + 'Falling back to individual IP rules.')
        logger.info(
          `💡 Lists API rate limit reached. Individual rules will be used this time. ` +
            'Consider retrying later or upgrading your Cloudflare plan.',
        )
      } else {
        logger.warn(`🚫 Lists API error during ${operation}: ${error.message}. Falling back to individual IP rules.`)
        logger.info(
          `💡 Lists API temporarily unavailable. Using individual IP rules as fallback. ` +
            'Check Cloudflare status if this persists.',
        )
      }
    } else {
      logger.warn(`🚫 Unknown Lists API error during ${operation}. Falling back to individual IP rules.`)
    }
  }
}
