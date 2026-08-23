import { logger } from '../../logger'
import { BaseFirewallService } from '../BaseFirewallService'
import { FastlyClient, DOORMAN_DENY_LIST_NAME, DOORMAN_ALLOW_LIST_NAME } from './FastlyClient'
import { RuleTranslator } from '../../translators'
import { isDeepEqual } from '../../utils/isDeepEqual'
import { omitId } from '../../utils/omitId'
import { unifiedConfigSchema } from '../../schemas/unifiedSchemas'
import { hasExplicitPriorities } from '../../utils/sortRulesByPriority'
import type {
  IFirewallProvider,
  ProviderType,
  SyncOptions,
  SyncResult,
  ChangeSet,
  FeatureSet,
  HealthScore,
  ValidationResult,
} from '../IFirewallProvider'
import type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from '../../types/unified'
import type { FastlyRule, FastlyRuleInput } from '../../types/fastly'

/**
 * Fastly Next-Gen WAF Firewall Service.
 * Implements `IFirewallProvider` for Fastly's Next-Gen WAF.
 *
 * Fastly's rule write model is per-rule (individual create/update/delete
 * calls against `/ngwaf/v1/workspaces/{id}/rules`, server-assigned ids on
 * create) — structurally the same shape as Vercel's, not Cloudflare's
 * atomic whole-ruleset replace — so `syncRules` mirrors
 * `VercelFirewallService.syncRules` closely: independent per-item
 * try/catch, `idRemappings`, post-sync verification. IP allow/block-listing
 * is the opposite: Fastly has no per-IP-rule resource, only a `list` of
 * type `ip` whose `entries[]` array is replaced wholesale — that part
 * mirrors Cloudflare's atomic ruleset write instead. See `translator.ts`'s
 * IP-list note for why.
 *
 * Fastly's rules API has no draft/publish step — create/update/delete take
 * effect immediately (gated only by each rule's `enabled` flag). This
 * resolves issue #186's "draft/activate versioning" open question: that
 * concern applies to Fastly's classic VCL service versioning, which is
 * explicitly out of scope here, not to Next-Gen WAF's rules API.
 */
export class FastlyFirewallService extends BaseFirewallService implements IFirewallProvider {
  public readonly name: ProviderType = 'fastly'

  constructor(private client: FastlyClient) {
    super()
  }

  /**
   * Fetch configuration from Fastly.
   */
  async fetchConfig(): Promise<UnifiedConfig> {
    try {
      logger.debug('Fetching Fastly Next-Gen WAF configuration')
      const [fastlyRules, denyList, allowList] = await Promise.all([
        this.client.fetchRules(),
        this.client.findList(DOORMAN_DENY_LIST_NAME),
        this.client.findList(DOORMAN_ALLOW_LIST_NAME),
      ])

      const rules = this.translateFastlyRules(fastlyRules)

      const ips: UnifiedIPRule[] = [
        ...RuleTranslator.fastlyListEntriesToUnified(denyList?.entries ?? [], 'deny'),
        ...RuleTranslator.fastlyListEntriesToUnified(allowList?.entries ?? [], 'allow'),
      ]

      return {
        version: '2.0',
        provider: 'fastly',
        // Must match Vercel's/Cloudflare's fetchConfig — see the comment on
        // VercelFirewallService.fetchConfig for why providers.<provider>
        // has to be set alongside `provider`.
        providers: {
          fastly: {
            workspaceId: this.client['workspaceId'],
          },
        },
        rules,
        ips,
      }
    } catch (error) {
      logger.error('Error fetching Fastly configuration:', error)
      throw new Error('Failed to fetch Fastly Next-Gen WAF configuration')
    }
  }

  /**
   * Translates Fastly rules to unified format, skipping rule categories
   * doorman doesn't manage (see `translator.ts`'s `fastlyToUnified` doc
   * comment) rather than forcing a lossy translation of every rule.
   */
  private translateFastlyRules(fastlyRules: FastlyRule[]): UnifiedRule[] {
    const rules: UnifiedRule[] = []
    for (const rule of fastlyRules) {
      if (rule.type !== 'request' && rule.type !== 'rate_limit') {
        logger.debug(
          `Skipping Fastly rule ${rule.id} — type "${rule.type}" is not a request/rate_limit rule doorman manages`,
        )
        continue
      }
      const translation = RuleTranslator.fastlyToUnified(rule)
      if (translation.warnings.length > 0) {
        translation.warnings.forEach((w) => {
          const { TranslationWarningSystem } = require('../../translators/TranslationWarningSystem')
          logger.warn(`Rule ${rule.description || rule.id}:\n${TranslationWarningSystem.formatWarning(w)}`)
        })
      }
      rules.push(translation.result)
    }
    return rules
  }

  /**
   * Sync rules to Fastly.
   */
  async syncRules(config: UnifiedConfig, options: SyncOptions = {}): Promise<SyncResult> {
    const { dryRun = false } = options

    try {
      const { OperationSafety } = require('../../utils/operationSafety')

      const dryRunResult = await OperationSafety.performDryRunValidation(
        config,
        'sync rules',
        async (cfg: UnifiedConfig) => this.getChanges(cfg),
      )

      if (!dryRunResult.valid) {
        throw new Error(`Dry-run validation failed: ${dryRunResult.issues.join(', ')}`)
      }

      const changes = dryRunResult.changes as ChangeSet
      const { rulesToAdd, rulesToUpdate, rulesToDelete } = changes
      const ipsToAdd = changes.ipsToAdd || []
      const ipsToDelete = changes.ipsToDelete || []

      if (dryRun) {
        logger.info('Dry run mode. The following changes would be made:')
        logger.info(
          `Custom Rules - Add: ${rulesToAdd.length}, Update: ${rulesToUpdate.length}, Delete: ${rulesToDelete.length}`,
        )
        logger.info(`IP Rules - Add: ${ipsToAdd.length}, Delete: ${ipsToDelete.length}`)
        return {
          success: true,
          rulesAdded: 0,
          rulesUpdated: 0,
          rulesDeleted: 0,
          ipsAdded: 0,
          ipsUpdated: 0,
          ipsDeleted: 0,
          warnings: dryRunResult.warnings,
        }
      }

      const riskLevel = OperationSafety.assessOperationRisk(changes, config)
      const confirmed = await OperationSafety.confirmDestructiveOperation({
        operation: 'sync rules',
        target: `Fastly workspace ${this.client['workspaceId']}`,
        changes,
        riskLevel,
        skipConfirmation: options.force || false,
        dryRun: false,
        allowDeletions: options.allowDeletions || false,
      })

      if (!confirmed) {
        throw new Error('Operation cancelled by user')
      }

      // Fastly Next-Gen WAF rules have no evaluation-order concept exposed
      // by the API at all (unlike Vercel's best-effort insertion order, or
      // Cloudflare's fully-honoured ordered replace) — each rule is
      // evaluated independently. Saying so once, up front, beats letting
      // the user assume `priority` did something.
      const warnings: string[] = []
      if (hasExplicitPriorities(config.rules)) {
        warnings.push(
          'Rule `priority` has no effect on Fastly: Next-Gen WAF rules are evaluated independently and have no ' +
            'API-exposed ordering concept to honour.',
        )
      }

      const toAdd = rulesToAdd.map((rule) => ({ rule, translated: RuleTranslator.unifiedToFastly(rule) }))
      const toUpdate = rulesToUpdate.map((rule) => ({ rule, translated: RuleTranslator.unifiedToFastly(rule) }))

      const errors: string[] = []
      const describeError = (context: string, error: unknown): string =>
        `${context}: ${error instanceof Error ? error.message : String(error)}`

      const addedRules: FastlyRule[] = []
      const updatedRules: FastlyRule[] = []
      const deletedRuleIds: string[] = []

      // Rules whose Fastly-assigned id differs from what the local config
      // had (or had none of) — same reconciliation data Vercel's sync
      // reports, for the same reason (Fastly assigns its own id on create).
      const idRemappings: NonNullable<SyncResult['idRemappings']> = []

      // Delete before add/update, same ordering rationale as Vercel.
      for (const rule of rulesToDelete) {
        if (!rule.id) continue
        try {
          logger.debug(`Deleting Fastly rule: ${rule.id}`)
          await this.client.deleteRule(rule.id)
          deletedRuleIds.push(rule.id)
        } catch (error) {
          logger.error(`Failed to delete Fastly rule ${rule.id}:`, error)
          errors.push(describeError(`Failed to delete rule ${rule.id}`, error))
        }
      }

      for (const { rule, translated } of toAdd) {
        const input: FastlyRuleInput = translated.result
        try {
          logger.debug(`Adding new Fastly rule: ${input.description}`)
          const newRule = await this.client.createRule(input)
          addedRules.push(newRule)
          // `oldId` is the local rule's id even if that id was only ever a
          // local placeholder that never existed remotely — omitting it
          // whenever the local rule already had *some* id (matching Vercel's
          // `idRemappings.push({ oldId: rule.id || undefined, ... })`) is
          // what lets `applySyncResultToConfig`'s write-back correct it via
          // `remapByOldId` instead of falling through to a name-keyed lookup
          // it would never reach because `rule.id` is truthy.
          idRemappings.push({ oldId: rule.id || undefined, newId: newRule.id, name: input.description })
        } catch (error) {
          logger.error(`Failed to add Fastly rule "${input.description}":`, error)
          errors.push(describeError(`Failed to add rule "${input.description}"`, error))
        }
      }

      for (const { rule, translated } of toUpdate) {
        if (!rule.id) continue
        try {
          logger.debug(`Updating Fastly rule: ${rule.id}`)
          const updatedRule = await this.client.updateRule(rule.id, translated.result)
          updatedRules.push(updatedRule)
        } catch (error) {
          logger.error(`Failed to update Fastly rule ${rule.id}:`, error)
          errors.push(describeError(`Failed to update rule ${rule.id}`, error))
        }
      }

      // IP lists are replaced wholesale (see the class doc comment) —
      // compute the desired entries for each doorman-managed list and PATCH
      // only the ones that actually changed.
      let ipsAdded = 0
      let ipsDeleted = 0
      const localIPs = config.ips || []
      const { result: desired, warnings: ipWarnings } = RuleTranslator.unifiedIPsToFastlyEntries(localIPs)
      ipWarnings.forEach((w: { message: string }) => warnings.push(w.message))

      try {
        for (const [listName, desiredEntries] of [
          [DOORMAN_DENY_LIST_NAME, desired.denyEntries],
          [DOORMAN_ALLOW_LIST_NAME, desired.allowEntries],
        ] as const) {
          // Re-read current entries at write time rather than threading
          // them through from `getChanges` — list state is cheap to fetch
          // and this keeps `ChangeSet` to its documented public shape
          // instead of smuggling a provider-internal field through it.
          const currentList = await this.client.findList(listName)
          const currentEntries = currentList?.entries ?? []
          const added = desiredEntries.filter((ip) => !currentEntries.includes(ip))
          const removed = currentEntries.filter((ip) => !desiredEntries.includes(ip))
          if (added.length === 0 && removed.length === 0) continue

          const list = await this.client.getOrCreateList(listName)
          await this.client.updateListEntries(list.id, desiredEntries)
          ipsAdded += added.length
          ipsDeleted += removed.length
        }
      } catch (error) {
        logger.error('Failed to sync Fastly IP lists:', error)
        errors.push(describeError('Failed to sync IP lists', error))
      }

      logger.debug(
        `Custom Rules: Added: ${addedRules.length}, Updated: ${updatedRules.length}, Deleted: ${deletedRuleIds.length}`,
      )
      logger.debug(`IP Rules: Added: ${ipsAdded}, Deleted: ${ipsDeleted}`)

      return {
        success: errors.length === 0,
        rulesAdded: addedRules.length,
        rulesUpdated: updatedRules.length,
        rulesDeleted: deletedRuleIds.length,
        ipsAdded,
        ipsUpdated: 0,
        ipsDeleted,
        idRemappings: idRemappings.length > 0 ? idRemappings : undefined,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    } catch (error) {
      logger.error('Error during sync:', error)
      throw new Error(
        `Failed to synchronize firewall rules: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      )
    }
  }

  /**
   * Get changes between local and remote configuration.
   */
  async getChanges(config: UnifiedConfig): Promise<ChangeSet> {
    const configValidation = unifiedConfigSchema.safeParse(config)
    if (!configValidation.success) {
      throw new Error(`Invalid firewall configuration: ${configValidation.error.message}`)
    }

    try {
      logger.debug('Fetching existing Fastly configuration')
      const [fastlyRules, denyList, allowList] = await Promise.all([
        this.client.fetchRules(),
        this.client.findList(DOORMAN_DENY_LIST_NAME),
        this.client.findList(DOORMAN_ALLOW_LIST_NAME),
      ])

      // Diff in unified space, normalizing both sides through
      // `fastlyToUnified` — same reasoning as Vercel's getChanges: comparing
      // a translated local rule against an untranslated remote one produces
      // spurious diffs from defaults `unifiedToFastly` fills in that the
      // remote rule never had.
      //
      // Diff against `configValidation.data`, not the raw `config` param —
      // `fastlyToUnified` always sets `conditionLogic` explicitly (see
      // `extractUnifiedConditions`), but a local rule relying on the
      // schema's documented 'AND' default omits the key entirely. Reading
      // from the unparsed `config` meant that local rule had one fewer key
      // than the always-explicit translated remote side, so `isDeepEqual`
      // flagged it as a phantom "update" forever — the same bug found and
      // fixed on Vercel's getChanges, see #225.
      const remoteRules = this.translateFastlyRules(fastlyRules)
      const { toAdd, toUpdate, toDelete } = this.diffRules(configValidation.data.rules, remoteRules)

      const denyEntries = denyList?.entries ?? []
      const allowEntries = allowList?.entries ?? []
      const remoteIPs: UnifiedIPRule[] = [
        ...RuleTranslator.fastlyListEntriesToUnified(denyEntries, 'deny'),
        ...RuleTranslator.fastlyListEntriesToUnified(allowEntries, 'allow'),
      ]
      const { ipsToAdd, ipsToDelete } = this.diffIPs(configValidation.data.ips || [], remoteIPs)

      return {
        rulesToAdd: toAdd,
        rulesToUpdate: toUpdate,
        rulesToDelete: toDelete,
        ipsToAdd,
        ipsToUpdate: [],
        ipsToDelete,
        hasChanges:
          toAdd.length > 0 ||
          toUpdate.length > 0 ||
          toDelete.length > 0 ||
          ipsToAdd.length > 0 ||
          ipsToDelete.length > 0,
      }
    } catch (error) {
      logger.error('Error fetching existing Fastly configuration:', error)
      throw new Error('Failed to fetch existing Fastly configuration')
    }
  }

  getSupportedFeatures(): FeatureSet {
    return {
      supportsCustomRules: true,
      supportsIPBlocking: true,
      supportsRateLimiting: true,
      // Fastly's "templated_signal" rules are vendor-managed detections,
      // but doorman doesn't expose a config surface to enable/configure
      // them (see #183, reserved for all providers) — same as Vercel/
      // Cloudflare, this stays false until that surface exists.
      supportsManagedRules: false,
      supportsGeoBlocking: true,
      supportsRedirect: true,
      supportsChallenge: true,
    }
  }

  async verifyCredentials(): Promise<boolean> {
    return this.client.verifyCredentials()
  }

  public validateConfig(config: UnifiedConfig): ValidationResult {
    const baseValidation = super.validateConfig(config)
    const errors = [...baseValidation.errors]
    const warnings = [...baseValidation.warnings]

    if (config.provider && config.provider !== 'fastly') {
      errors.push({
        path: 'provider',
        message: `Provider must be 'fastly' for FastlyFirewallService`,
        code: 'INVALID_PROVIDER',
      })
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  public getHealthScore(config: UnifiedConfig): HealthScore {
    const baseScore = super.getHealthScore(config)
    const issues = [...baseScore.issues]
    let score = baseScore.score

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
   * `UnifiedRule` — see the comment in `getChanges`.
   */
  private diffRules(
    configRules: UnifiedRule[],
    existingRules: UnifiedRule[],
  ): { toAdd: UnifiedRule[]; toUpdate: UnifiedRule[]; toDelete: UnifiedRule[] } {
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
   * Diff IP rules. There's no `ipsToUpdate` case — a Fastly list entry is a
   * bare IP string (`hostname`/`notes` have no Fastly equivalent, dropped
   * by `unifiedIPsToFastlyEntries`), so once two entries have the same `ip`
   * and `action` there's nothing left that could differ between them.
   */
  private diffIPs(
    configIPs: UnifiedIPRule[],
    existingIPs: UnifiedIPRule[],
  ): { ipsToAdd: UnifiedIPRule[]; ipsToDelete: UnifiedIPRule[] } {
    const key = (ip: UnifiedIPRule) => `${ip.action}:${ip.ip}`
    const existingKeys = new Set(existingIPs.map(key))
    const configKeys = new Set(configIPs.map(key))

    return {
      ipsToAdd: configIPs.filter((ip) => !existingKeys.has(key(ip))),
      ipsToDelete: existingIPs.filter((ip) => !configKeys.has(key(ip))),
    }
  }
}
