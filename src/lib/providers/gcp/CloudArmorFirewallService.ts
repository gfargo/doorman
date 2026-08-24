import { logger } from '../../logger'
import { BaseFirewallService } from '../BaseFirewallService'
import { CloudArmorClient } from './CloudArmorClient'
import { RuleTranslator } from '../../translators'
import { parseCelExpression } from '../../translators/CelParser'
import { isDeepEqual } from '../../utils/isDeepEqual'
import { omitId } from '../../utils/omitId'
import { unifiedConfigSchema } from '../../schemas/unifiedSchemas'
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
import type { CloudArmorRule } from '../../types/gcp'

/** A rule's Cloud Armor priority also acts as its doorman `id` (stringified) — see translator.ts's file comment. */
function priorityOf(id: string | undefined): number | undefined {
  return id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined
}

/**
 * GCP Cloud Armor Firewall Service. Implements `IFirewallProvider` for
 * Cloud Armor's `securityPolicies` API.
 *
 * Structurally closest to Vercel's write model — individual per-rule
 * create/update/delete (`addRule`/`patchRule`/`removeRule`), not
 * Cloudflare's atomic whole-ruleset replace — but with one real difference
 * from every other provider: there is no separate, server-assigned rule id.
 * A rule's `priority` **is** its id, its evaluation order, and its
 * addressing key all at once (see translator.ts and `priorityOf` above).
 * There is also no dedicated IP-blocking resource — an IP rule is just
 * another entry in the same flat `rules[]` array, classified on fetch via
 * `looksLikeIpRule` (see translator.ts's file comment).
 *
 * New local rules/IPs with no priority yet get one assigned by
 * `assignPriorities` before translation — spaced 1000 apart, matching
 * common Cloud Armor/gcloud convention, and never colliding with a
 * priority already in use (locally or remotely).
 */
export class CloudArmorFirewallService extends BaseFirewallService implements IFirewallProvider {
  public readonly name: ProviderType = 'gcp'

  constructor(private client: CloudArmorClient) {
    super()
  }

  async fetchConfig(): Promise<UnifiedConfig> {
    try {
      logger.debug('Fetching Cloud Armor security policy')
      const policy = await this.client.getPolicy()
      const { rules, ips } = this.translatePolicy(policy)

      return {
        version: '2.0',
        provider: 'gcp',
        // Must match the other providers' fetchConfig — see the comment on
        // VercelFirewallService.fetchConfig for why providers.<provider>
        // has to be set alongside `provider`.
        providers: {
          gcp: {
            projectId: this.client.projectId,
            policyName: this.client['policyName'],
          },
        },
        rules,
        ips,
      }
    } catch (error) {
      logger.error('Error fetching Cloud Armor configuration:', error)
      throw new Error('Failed to fetch Cloud Armor security policy')
    }
  }

  /**
   * `localRuleIds` (ids present in the local config's `rules[]`, i.e.
   * `getChanges`'s caller) breaks the classification tie described below in
   * the local config's favor — see #248. `fetchConfig` has no local config
   * to check against and passes nothing, preserving its prior CEL-shape-only
   * behavior (there's no existing classification to conflict with when
   * building a config from scratch).
   */
  private translatePolicy(
    policy: { rules: CloudArmorRule[] },
    localRuleIds?: ReadonlySet<string>,
  ): { rules: UnifiedRule[]; ips: UnifiedIPRule[] } {
    const rules: UnifiedRule[] = []
    const ips: UnifiedIPRule[] = []

    for (const rule of policy.rules) {
      // Parsed once and threaded through both the classification check and
      // whichever translation follows it, rather than each re-parsing the
      // same CEL expression from scratch.
      const parsed = parseCelExpression(rule.match.expr.expression)

      // Cloud Armor has no field distinguishing "IP-blocking entry" from
      // "ordinary rule that happens to match on ip" — a single ip==X
      // condition under `rules[]` produces CEL byte-identical to a real
      // `ips[]` entry (#248). looksLikeIpRule can't resolve that ambiguity
      // from CEL shape alone, so when the caller knows this rule's priority
      // already exists in local `rules[]`, that wins the tie regardless of
      // shape — otherwise a hand-authored single-IP rule gets silently
      // reclassified into `ips[]` on every fetch, which getChanges then
      // reads as "delete the rule, create an orphaned IP entry," forever.
      const isKnownLocalRule = localRuleIds?.has(String(rule.priority)) ?? false
      if (!isKnownLocalRule && RuleTranslator.gcpLooksLikeIpRule(rule, parsed)) {
        ips.push(RuleTranslator.gcpToUnifiedIP(rule, parsed))
        continue
      }
      const translation = RuleTranslator.gcpToUnified(rule, parsed)
      if (translation.warnings.length > 0) {
        translation.warnings.forEach((w) => {
          const { TranslationWarningSystem } = require('../../translators/TranslationWarningSystem')
          logger.warn(`Rule ${rule.description || rule.priority}:\n${TranslationWarningSystem.formatWarning(w)}`)
        })
      }
      rules.push(translation.result)
    }

    return { rules, ips }
  }

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
          warnings: dryRunResult.warnings,
        }
      }

      const riskLevel = OperationSafety.assessOperationRisk(changes, config)
      const confirmed = await OperationSafety.confirmDestructiveOperation({
        operation: 'sync rules',
        target: `Cloud Armor policy ${this.client['policyName']}`,
        changes,
        riskLevel,
        skipConfirmation: options.force || false,
        dryRun: false,
        allowDeletions: options.allowDeletions || false,
      })

      if (!confirmed) {
        throw new Error('Operation cancelled by user')
      }

      const warnings: string[] = []
      const errors: string[] = []
      const describeError = (context: string, error: unknown): string =>
        `${context}: ${error instanceof Error ? error.message : String(error)}`

      // Priorities occupied by anything staying as-is (unchanged, updating,
      // or being deleted after this sync — deleting frees a priority, but
      // reusing it in the *same* sync risks racing the delete) plus every
      // remote rule this sync doesn't touch at all. Fetching fresh here
      // (rather than reusing getChanges' snapshot) avoids assigning a
      // priority that collided with something added between the diff and
      // this point.
      const remotePolicy = await this.client.getPolicy()
      const occupied = new Set(remotePolicy.rules.map((r) => r.priority))

      let nextCandidate = 1000
      const assignPriority = (): number => {
        while (occupied.has(nextCandidate)) nextCandidate += 1000
        occupied.add(nextCandidate)
        return nextCandidate
      }

      const idRemappings: NonNullable<SyncResult['idRemappings']> = []

      // Every loop below (delete/add/update, rules and IPs alike) awaits
      // each item in turn rather than firing them concurrently. Deletes
      // must precede adds/updates for the priority-reuse race described
      // above — that part's necessary. Whether items *within* one category
      // (e.g. all of rulesToAdd) could safely run concurrently is a
      // separate question this codebase doesn't have an answer to: no
      // research or real-API testing here has established whether Cloud
      // Armor's securityPolicies API tolerates concurrent mutations against
      // the same policy resource (unlike the cross-category ordering above,
      // which is a documented, deliberate constraint). Staying fully
      // sequential is the deliberate, conservative choice until that's
      // verified against a real GCP project — see #251, which also fixed
      // waitForOperation's poll cadence to reduce the cost of staying
      // sequential in the meantime.
      // Delete before add/update, same ordering rationale as Vercel/Fastly.
      for (const rule of [...rulesToDelete, ...ipsToDelete]) {
        const priority = priorityOf(rule.id)
        if (priority === undefined) continue
        try {
          logger.debug(`Removing Cloud Armor rule at priority ${priority}`)
          await this.client.removeRule(priority)
        } catch (error) {
          logger.error(`Failed to remove Cloud Armor rule at priority ${priority}:`, error)
          errors.push(describeError(`Failed to delete rule at priority ${priority}`, error))
        }
      }

      let rulesAdded = 0
      for (const rule of rulesToAdd) {
        const priority = rule.priority ?? assignPriority()
        // Translation happens inside the try, not before it: it can throw
        // (CelExpressionBuilder rejects unsupported fields, parseWindowToSeconds
        // rejects a malformed rate-limit window) just as easily as the network
        // call can fail, and a throw here needs the exact same per-item
        // isolation — recorded in errors[], loop moves on — rather than
        // escaping to the outer catch and discarding every rule already
        // added by an earlier iteration in this same loop (#250).
        try {
          const translation = RuleTranslator.unifiedToGcp({ ...rule, priority })
          translation.warnings.forEach((w) => warnings.push(w.message))
          logger.debug(`Adding Cloud Armor rule at priority ${priority}: ${translation.result.description}`)
          await this.client.addRule(translation.result)
          rulesAdded++
          idRemappings.push({ oldId: rule.id, newId: String(priority), name: rule.name })
        } catch (error) {
          logger.error(`Failed to add Cloud Armor rule "${rule.name}":`, error)
          errors.push(describeError(`Failed to add rule "${rule.name}"`, error))
        }
      }

      let rulesUpdated = 0
      for (const rule of rulesToUpdate) {
        const oldPriority = priorityOf(rule.id)
        if (oldPriority === undefined) continue

        // Translation (and the relocation check that depends on it) happens
        // inside the try — see the identical reasoning on the rulesToAdd
        // loop above (#250).
        try {
          const translation = RuleTranslator.unifiedToGcp(rule)
          translation.warnings.forEach((w) => warnings.push(w.message))

          // Cloud Armor has no "change priority" operation (see types/gcp.ts's
          // CloudArmorRule doc comment) — a PATCH is always addressed by, and
          // can only touch, the rule already at oldPriority; a body that also
          // carries a different desired priority doesn't relocate it, the
          // field is just ignored server-side. Route a priority change through
          // remove-then-add-at-the-new-priority instead, the one relocation
          // path the real API supports, with the same idRemappings bookkeeping
          // a brand-new rule gets — this rule's addressing id is changing too
          // (#249).
          const relocating = rule.priority !== undefined && rule.priority !== oldPriority
          if (relocating) {
            logger.debug(`Relocating Cloud Armor rule from priority ${oldPriority} to ${rule.priority}`)
            await this.client.removeRule(oldPriority)
            await this.client.addRule(translation.result)
            idRemappings.push({ oldId: rule.id, newId: String(rule.priority), name: rule.name })
          } else {
            logger.debug(`Updating Cloud Armor rule at priority ${oldPriority}`)
            await this.client.patchRule(oldPriority, translation.result)
          }
          rulesUpdated++
        } catch (error) {
          logger.error(`Failed to update Cloud Armor rule at priority ${oldPriority}:`, error)
          errors.push(describeError(`Failed to update rule at priority ${oldPriority}`, error))
        }
      }

      let ipsAdded = 0
      for (const ip of ipsToAdd) {
        const priority = priorityOf(ip.id) ?? assignPriority()
        // Translation inside the try — unifiedIPToGcp throws on an invalid
        // IP/CIDR, same isolation reasoning as rulesToAdd above (#250).
        try {
          const translated = RuleTranslator.unifiedIPToGcp(ip, priority)
          logger.debug(`Adding Cloud Armor IP rule at priority ${priority}: ${ip.ip}`)
          await this.client.addRule(translated)
          ipsAdded++
          idRemappings.push({ oldId: ip.id, newId: String(priority), name: ip.ip })
        } catch (error) {
          logger.error(`Failed to add Cloud Armor IP rule for ${ip.ip}:`, error)
          errors.push(describeError(`Failed to add IP rule for ${ip.ip}`, error))
        }
      }

      let ipsUpdated = 0
      for (const ip of ipsToUpdate) {
        const priority = priorityOf(ip.id)
        if (priority === undefined) continue
        try {
          logger.debug(`Updating Cloud Armor IP rule at priority ${priority}: ${ip.ip}`)
          await this.client.patchRule(priority, RuleTranslator.unifiedIPToGcp(ip, priority))
          ipsUpdated++
        } catch (error) {
          logger.error(`Failed to update Cloud Armor IP rule at priority ${priority}:`, error)
          errors.push(describeError(`Failed to update IP rule at priority ${priority}`, error))
        }
      }

      logger.debug(`Custom Rules: Added: ${rulesAdded}, Updated: ${rulesUpdated}, Deleted: ${rulesToDelete.length}`)
      logger.debug(`IP Rules: Added: ${ipsAdded}, Updated: ${ipsUpdated}, Deleted: ${ipsToDelete.length}`)

      return {
        success: errors.length === 0,
        rulesAdded,
        rulesUpdated,
        rulesDeleted: rulesToDelete.length,
        ipsAdded,
        ipsUpdated,
        ipsDeleted: ipsToDelete.length,
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

  async getChanges(config: UnifiedConfig): Promise<ChangeSet> {
    const configValidation = unifiedConfigSchema.safeParse(config)
    if (!configValidation.success) {
      throw new Error(`Invalid firewall configuration: ${configValidation.error.message}`)
    }

    try {
      logger.debug('Fetching existing Cloud Armor configuration')
      const policy = await this.client.getPolicy()
      const localRuleIds = new Set(config.rules.map((r) => r.id).filter((id): id is string => id !== undefined))
      const { rules: remoteRules, ips: remoteIPs } = this.translatePolicy(policy, localRuleIds)

      // Diff in unified space, normalizing both sides through gcpToUnified —
      // same reasoning as every other provider's getChanges: comparing a
      // translated local rule against an untranslated remote one produces
      // spurious diffs from defaults unifiedToGcp fills in that the remote
      // rule never had. Rules without a priority yet (brand-new local
      // rules) never collide with a real remote id, so they always land in
      // toAdd, exactly as intended.
      const {
        toAdd: rulesToAdd,
        toUpdate: rulesToUpdate,
        toDelete: rulesToDelete,
      } = this.diffItems<UnifiedRule>(config.rules, remoteRules, (a, b) => isDeepEqual(omitId(a), omitId(b)))
      const {
        toAdd: ipsToAdd,
        toUpdate: ipsToUpdate,
        toDelete: ipsToDelete,
      } = this.diffItems<UnifiedIPRule>(config.ips || [], remoteIPs, (a, b) => isDeepEqual(omitId(a), omitId(b)))

      return {
        rulesToAdd,
        rulesToUpdate,
        rulesToDelete,
        ipsToAdd,
        ipsToUpdate,
        ipsToDelete,
        hasChanges:
          rulesToAdd.length > 0 ||
          rulesToUpdate.length > 0 ||
          rulesToDelete.length > 0 ||
          ipsToAdd.length > 0 ||
          ipsToUpdate.length > 0 ||
          ipsToDelete.length > 0,
      }
    } catch (error) {
      logger.error('Error fetching existing Cloud Armor configuration:', error)
      throw new Error('Failed to fetch existing Cloud Armor configuration')
    }
  }

  getSupportedFeatures(): FeatureSet {
    return {
      supportsCustomRules: true,
      supportsIPBlocking: true,
      supportsRateLimiting: true,
      // Preconfigured WAF rules (evaluatePreconfiguredWaf()) exist on the
      // real API but doorman has no config surface to enable/configure them
      // yet (see #183, reserved for all providers) — same as every other
      // provider, this stays false until that surface exists.
      supportsManagedRules: false,
      supportsGeoBlocking: true,
      supportsRedirect: true,
      // No standalone challenge action for ordinary custom rules — see
      // CompatibilityMatrix's `gcp` entry for `challenge`.
      supportsChallenge: false,
    }
  }

  async verifyCredentials(): Promise<boolean> {
    return this.client.verifyCredentials()
  }

  public validateConfig(config: UnifiedConfig): ValidationResult {
    const baseValidation = super.validateConfig(config)
    const errors = [...baseValidation.errors]
    const warnings = [...baseValidation.warnings]

    if (config.provider && config.provider !== 'gcp') {
      errors.push({
        path: 'provider',
        message: `Provider must be 'gcp' for CloudArmorFirewallService`,
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
}
