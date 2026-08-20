/**
 * Adapter between legacy (pre-multi-provider) Vercel config files and the
 * shared `UnifiedConfig` format `VercelFirewallService`/`IFirewallProvider`
 * consume.
 *
 * Every real Vercel user's `.doorman.json` today is legacy-shaped
 * (`rule.conditionGroup`, `action.mitigate`, top-level `version`/
 * `updatedAt`, no `provider` field). `VercelFirewallService` only knows how
 * to consume `UnifiedConfig` (`rule.conditions`, `action.type`), and
 * `OperationSafety` hard-fails any config with no `provider` field — so
 * routing an unconverted legacy config through the generic provider path
 * throws immediately. This module bridges that gap in-memory; it never
 * silently rewrites a user's file into unified format as a side effect —
 * that's a distinct, opt-in concern out of scope here.
 */

import { hasProviderMetadata } from '../types/unified'
import { RuleTranslator } from '../translators/RuleTranslator'
import type { FirewallConfig } from '../types'
import type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from '../types/unified'
import type { VercelCustomRule, VercelIPBlockingRule } from '../types/vercel'
import type { SyncResult } from '../providers/IFirewallProvider'

/**
 * Convert a legacy Vercel `FirewallConfig`, or an already-unified config
 * (passed through unchanged), into a `UnifiedConfig`.
 *
 * Legacy `CustomRule`/`IPBlockingRule` (src/lib/types.ts) and Vercel's own
 * `VercelCustomRule`/`VercelIPBlockingRule` (src/lib/types/vercel.ts) are
 * structurally identical — they were modeled as parallel interfaces, not a
 * shared one — so a legacy rule is passed to `RuleTranslator` as-is.
 */
export function toUnifiedConfig(config: FirewallConfig | UnifiedConfig): UnifiedConfig {
  if (hasProviderMetadata(config)) {
    return config as UnifiedConfig
  }

  const legacy = config as FirewallConfig

  const rules: UnifiedRule[] = legacy.rules.map((rule) => {
    const translation = RuleTranslator.vercelToUnified(rule as unknown as VercelCustomRule)
    return translation.result
  })

  const ips: UnifiedIPRule[] = (legacy.ips ?? []).map((ip) =>
    RuleTranslator.vercelIPToUnified(ip as unknown as VercelIPBlockingRule),
  )

  return {
    version: '2.0',
    provider: 'vercel',
    providers: {
      vercel: {
        projectId: legacy.projectId,
        teamId: legacy.teamId,
      },
    },
    rules,
    ips,
    metadata: {
      version: legacy.version,
      updatedAt: legacy.updatedAt,
    },
  }
}

/**
 * Result of applying a sync result's version/id-remapping data back onto a
 * config object.
 */
export interface ConfigWriteBack<T extends FirewallConfig | UnifiedConfig> {
  config: T
  /** Whether anything actually changed — callers use this to decide
   * whether a save is needed at all. */
  changed: boolean
}

/**
 * Format-preserving write-back of a sync result onto the *original*
 * (pre-`toUnifiedConfig`) config object a caller loaded from disk — not the
 * in-memory `UnifiedConfig` `toUnifiedConfig` produces for talking to the
 * provider. A legacy-shaped config's write-back goes to its top-level
 * `version`/`updatedAt` fields (what the legacy sync flow always wrote); an
 * already-unified config's write-back goes to `metadata.version`/
 * `metadata.updatedAt`, leaving the top-level `version` (the config
 * *format* string, e.g. "2.0") untouched — the two are different concepts
 * that happen to share a field name only on the legacy shape.
 *
 * Also applies any `idRemappings` from the sync result to matching
 * `config.rules[i].id` values — a rule with an `oldId` match is updated by
 * id; an id-less rule (no `oldId` in the remapping) is matched by `name`
 * instead, since there was no previous id to compare against.
 */
export function applySyncResultToConfig<T extends FirewallConfig | UnifiedConfig>(
  originalConfig: T,
  result: Pick<SyncResult, 'version' | 'updatedAt' | 'idRemappings'>,
): ConfigWriteBack<T> {
  let changed = false
  const isUnified = hasProviderMetadata(originalConfig)

  let config: FirewallConfig | UnifiedConfig = isUnified
    ? { ...(originalConfig as UnifiedConfig), metadata: { ...(originalConfig as UnifiedConfig).metadata } }
    : { ...(originalConfig as FirewallConfig) }

  if (result.version !== undefined) {
    if (isUnified) {
      const unified = config as UnifiedConfig
      if (unified.metadata?.version !== result.version) {
        unified.metadata = {
          ...unified.metadata,
          version: result.version,
          updatedAt: result.updatedAt ?? new Date().toISOString(),
        }
        changed = true
      }
    } else {
      const legacy = config as FirewallConfig
      if (legacy.version !== result.version) {
        legacy.version = result.version
        legacy.updatedAt = result.updatedAt ?? new Date().toISOString()
        changed = true
      }
    }
  }

  if (result.idRemappings && result.idRemappings.length > 0) {
    const remapByOldId = new Map(
      result.idRemappings.filter((r) => r.oldId).map((r) => [r.oldId, r.newId] as [string, string]),
    )
    const remapByName = new Map(
      result.idRemappings.filter((r) => !r.oldId).map((r) => [r.name, r.newId] as [string, string]),
    )

    let rulesChanged = false
    const remappedRules = (config.rules as Array<{ id?: string; name: string }>).map((rule) => {
      const newId = rule.id ? remapByOldId.get(rule.id) : remapByName.get(rule.name)
      if (newId && newId !== rule.id) {
        rulesChanged = true
        return { ...rule, id: newId }
      }
      return rule
    })

    if (rulesChanged) {
      config = { ...config, rules: remappedRules } as FirewallConfig | UnifiedConfig
      changed = true
    }
  }

  return { config: config as T, changed }
}

/**
 * Format-preserving conversion of a freshly-fetched `UnifiedConfig` (from
 * `provider.fetchConfig()`) into whatever shape the existing on-disk config
 * was in — used by `download`, which (unlike `sync`) replaces the entire
 * local rule/IP set with the remote state, not just a version/id delta.
 *
 * Naively spreading the fetched `UnifiedConfig` onto a legacy on-disk
 * config (`{ ...existingConfig, ...remote }`) corrupts it: `remote.version`
 * is the unified format string ("2.0"), not a real Vercel config version,
 * and `remote.rules`/`remote.ips` are unified-shaped
 * (`rule.conditions`/`action.type`), not the legacy
 * `conditionGroup`/`action.mitigate` shape the rest of the legacy tooling
 * (and the user's file) expects.
 */
export function fromUnifiedConfig(
  remote: UnifiedConfig,
  existingConfig: FirewallConfig | UnifiedConfig,
): FirewallConfig | UnifiedConfig {
  if (hasProviderMetadata(existingConfig)) {
    return { ...(existingConfig as UnifiedConfig), ...remote }
  }

  const legacy = existingConfig as FirewallConfig
  const rules = remote.rules.map(
    (rule) => RuleTranslator.unifiedToVercel(rule).result as unknown as FirewallConfig['rules'][number],
  )
  const ips = (remote.ips ?? []).map((ip) => ({
    id: ip.id || '',
    ip: ip.ip,
    hostname: ip.hostname || '',
    action: ip.action as 'deny',
    notes: ip.notes,
  })) as unknown as NonNullable<FirewallConfig['ips']>

  return {
    ...legacy,
    projectId: remote.providers?.vercel?.projectId ?? legacy.projectId,
    teamId: remote.providers?.vercel?.teamId ?? legacy.teamId,
    version: remote.metadata?.version,
    updatedAt: remote.metadata?.updatedAt,
    rules,
    ips,
  }
}
