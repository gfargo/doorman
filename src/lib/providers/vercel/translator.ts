import type {
  VercelCustomRule,
  VercelIPBlockingRule,
  VercelConditionGroup,
  VercelRuleCondition,
  VercelRuleOperator,
  VercelRuleType,
  VercelActionType,
} from '../../types/vercel'
import type { UnifiedRule, UnifiedIPRule, UnifiedCondition, UnifiedAction } from '../../types/unified'
import type { Operator, ActionType } from '../../types/common'
import type { TranslationResult, TranslationWarning } from '../../translators/TranslationTypes'
import { TranslationWarningSystem } from '../../translators/TranslationWarningSystem'

/**
 * Vercel's half of the Vercel <-> Unified translation. Split out of the
 * former monolithic `RuleTranslator` (#196) so Vercel's translation logic
 * lives with the rest of the Vercel adapter, and a future provider's
 * translator doesn't have to be added to this file to exist.
 */

/**
 * Translate Vercel rule to Unified format
 */
export function vercelToUnified(rule: VercelCustomRule): TranslationResult<UnifiedRule> {
  const warnings: TranslationWarning[] = []
  const conditions: UnifiedCondition[] = []

  // Flatten condition groups into a single array, but tag each condition
  // with its source group index (`group`) so unifiedToVercel can rebuild
  // the original AND-within/OR-across structure later. Previously this
  // discarded which conditions were AND'd together within a group —
  // even a single-group, multi-condition rule (meant to be AND'd) was
  // mistranslated, since `conditionLogic` below was hardcoded to 'OR'
  // unconditionally rather than reflecting whether groups.length > 1.
  rule.conditionGroup.forEach((group, groupIndex) => {
    for (const condition of group.conditions) {
      const operator = mapVercelOperatorToUnified(condition.op)

      conditions.push({
        field: mapVercelTypeToUnified(condition.type),
        operator,
        // Conditional spread, not `value: condition.value` — an unconditional
        // assignment creates a `value: undefined` key for an `ex`/`nex`
        // condition (whose Vercel-native value is always undefined by
        // design, #213), which isDeepEqual treats as a different shape than
        // the key being absent entirely (the local-config-loaded-from-disk
        // case, since JSON.stringify drops undefined). Same bug, same fix,
        // as `negated` right below. See #203, #231.
        ...(condition.value !== undefined ? { value: condition.value as string | number | string[] | number[] } : {}),
        ...(condition.neg ? { negated: true } : {}),
        ...(condition.key ? { key: condition.key } : {}),
        group: groupIndex,
      })
    }
  })

  // Warn about complex rules with many conditions
  if (conditions.length > 10) {
    warnings.push(
      TranslationWarningSystem.createWarning(
        'many_conditions',
        rule.id,
        undefined,
        `Rule has ${conditions.length} conditions which may impact performance`,
        'Consider splitting complex rules into multiple simpler rules for better performance',
      ),
    )
  }

  // Conditional spread, not `key: value ?? undefined` — the same
  // undefined-vs-absent-key bug as the condition loop above (see #203), one
  // level up: an ordinary rule with no rate limit/redirect/duration set
  // (the common case — deny/challenge/log/bypass) previously still produced
  // `rateLimit: undefined, redirect: undefined, duration: undefined` keys,
  // which isDeepEqual treats as extra keys the local config never has.
  const action: UnifiedAction = {
    type: rule.action.mitigate.action,
    ...(rule.action.mitigate.rateLimit
      ? {
          rateLimit: {
            requests: rule.action.mitigate.rateLimit.requests,
            window: rule.action.mitigate.rateLimit.window,
            // Same conditional-spread reasoning, nested one level further —
            // a rate-limit rule with only requests/window set (the common
            // case, including doorman's own "Rate Limit API" template) still
            // produced these three as undefined-valued keys otherwise.
            ...(rule.action.mitigate.rateLimit.characteristics
              ? { characteristics: rule.action.mitigate.rateLimit.characteristics }
              : {}),
            ...(rule.action.mitigate.rateLimit.mitigationTimeout
              ? { mitigationTimeout: rule.action.mitigate.rateLimit.mitigationTimeout }
              : {}),
            ...(rule.action.mitigate.rateLimit.countingExpression
              ? { countingExpression: rule.action.mitigate.rateLimit.countingExpression }
              : {}),
          },
        }
      : {}),
    ...(rule.action.mitigate.redirect
      ? {
          redirect: {
            location: rule.action.mitigate.redirect.location,
            ...(rule.action.mitigate.redirect.permanent ? { permanent: rule.action.mitigate.redirect.permanent } : {}),
          },
        }
      : {}),
    ...(rule.action.mitigate.actionDuration ? { duration: rule.action.mitigate.actionDuration } : {}),
  }

  const unifiedRule: UnifiedRule = {
    id: rule.id,
    name: rule.name,
    // Conditional spread, not `description: rule.description` — same
    // undefined-vs-absent-key bug, one more level up: a rule with no
    // description (very common — it's optional in both shapes) previously
    // still produced a `description: undefined` key. See #203.
    ...(rule.description ? { description: rule.description } : {}),
    enabled: rule.active,
    conditions,
    // Informational only once `group` is set above — real join semantics
    // for translation come from the per-condition `group` index (AND
    // within a group, OR across groups), which a flat 'AND'|'OR' can't
    // express for a multi-group rule. Kept accurate for any caller that
    // still reads this field without being group-aware.
    conditionLogic: rule.conditionGroup.length > 1 ? 'OR' : 'AND',
    action,
  }

  return { result: unifiedRule, warnings }
}

/**
 * Translate Unified rule to Vercel
 */
export function unifiedToVercel(rule: UnifiedRule): TranslationResult<VercelCustomRule> {
  const warnings: TranslationWarning[] = []

  const conditionGroups = buildVercelConditionGroups(rule.conditions, rule.id, warnings)

  // Vercel's mitigate action has no custom-response-body concept, so a
  // rule carrying one loses it here. Warn rather than drop silently —
  // same contract as an unmappable condition field above.
  if (rule.action.response) {
    warnings.push(
      TranslationWarningSystem.createUnsupportedFeatureWarning(
        'custom response body',
        'unified config',
        'Vercel',
        rule.id,
        'action.response',
      ),
    )
  }

  if (conditionGroups.length === 0) {
    throw new Error(
      `Rule "${rule.name}" has no conditions Vercel can represent — every condition field is unsupported ` +
        'by Vercel (e.g. Cloudflare-only fields like referer/port). Cannot sync this rule to Vercel.',
    )
  }

  const vercelRule: VercelCustomRule = {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    conditionGroup: conditionGroups,
    action: {
      mitigate: {
        action: mapUnifiedActionToVercel(rule.action.type),
        rateLimit: rule.action.rateLimit
          ? {
              requests: rule.action.rateLimit.requests,
              window: rule.action.rateLimit.window,
              characteristics: rule.action.rateLimit.characteristics,
              mitigationTimeout: rule.action.rateLimit.mitigationTimeout,
              countingExpression: rule.action.rateLimit.countingExpression,
            }
          : null,
        redirect: rule.action.redirect
          ? {
              location: rule.action.redirect.location,
              permanent: rule.action.redirect.permanent,
            }
          : null,
        actionDuration: rule.action.duration || null,
      },
    },
    active: rule.enabled,
  }

  return { result: vercelRule, warnings }
}

/**
 * Translate Vercel IP rule to Unified
 */
export function vercelIPToUnified(ip: VercelIPBlockingRule): UnifiedIPRule {
  return {
    id: ip.id,
    ip: ip.ip,
    // Conditional spread — same undefined-vs-absent-key bug as
    // vercelToUnified above (#203): a hostname-less IP rule (both fields
    // are optional; hostname especially so after #219) previously still
    // produced `hostname: undefined, notes: undefined` keys.
    ...(ip.hostname ? { hostname: ip.hostname } : {}),
    ...(ip.notes ? { notes: ip.notes } : {}),
    action: ip.action,
  }
}

/**
 * Groups unified conditions by their `group` index (set by `vercelToUnified`
 * when the rule originated from Vercel's own `conditionGroup[]` structure, or
 * by `WirefilterParser` when it came from a parsed Cloudflare expression)
 * into Vercel's `conditionGroup[]` shape, so a multi-group rule round-trips
 * correctly instead of collapsing into one group and changing what the rule
 * matches (AND-within/OR-across -> everything AND'd together). Conditions
 * with no `group` (e.g. a hand-authored config) all fall into one implicit
 * group.
 *
 * A condition whose field has no Vercel equivalent (e.g. Cloudflare-only
 * `referer`/`port`) is dropped with a warning pushed onto the caller's
 * `warnings` array, rather than mistranslated — silently relabeling it
 * would rewrite what the rule actually matches with no indication anything
 * was wrong. A group that ends up fully empty is dropped too — that
 * OR-branch simply doesn't exist in the output.
 */
function buildVercelConditionGroups(
  conditions: UnifiedCondition[],
  ruleId: string | undefined,
  warnings: TranslationWarning[],
): VercelConditionGroup[] {
  const groupedConditions = new Map<number, UnifiedCondition[]>()
  for (const condition of conditions) {
    const groupIndex = condition.group ?? 0
    const bucket = groupedConditions.get(groupIndex)
    if (bucket) {
      bucket.push(condition)
    } else {
      groupedConditions.set(groupIndex, [condition])
    }
  }

  const conditionGroups: VercelConditionGroup[] = []
  for (const groupConditions of groupedConditions.values()) {
    const mapped: VercelRuleCondition[] = []
    for (const condition of groupConditions) {
      const type = mapUnifiedTypeToVercel(condition.field)
      if (!type) {
        warnings.push(
          TranslationWarningSystem.createUnsupportedFeatureWarning(
            `condition field '${condition.field}'`,
            'unified config',
            'Vercel',
            ruleId,
            condition.field,
          ),
        )
        continue
      }
      const mappedOperator = mapUnifiedOperatorToVercel(condition.operator)
      if (!mappedOperator) {
        warnings.push(
          TranslationWarningSystem.createUnsupportedFeatureWarning(
            `operator '${condition.operator}'`,
            'unified config',
            'Vercel',
            ruleId,
            condition.field,
          ),
        )
        continue
      }
      mapped.push({
        op: mappedOperator.op,
        // XOR the operator's own required negation (e.g. `ne` -> `eq` +
        // forced neg) with the condition's independent `negated` flag —
        // `forceNeg: false` for every operator that doesn't need one makes
        // this reduce to plain `condition.negated`, so this is a strict
        // superset of the previous `neg: condition.negated` behavior, not a
        // change for any operator already working correctly.
        neg: mappedOperator.forceNeg !== Boolean(condition.negated),
        type,
        key: condition.key,
        value: condition.value,
      })
    }
    if (mapped.length > 0) {
      conditionGroups.push({ conditions: mapped })
    }
  }

  return conditionGroups
}

function mapVercelOperatorToUnified(op: string): Operator {
  const mapping: Record<string, Operator> = {
    eq: 'eq',
    pre: 'starts_with',
    suf: 'ends_with',
    inc: 'in',
    sub: 'contains',
    re: 'matches',
    ex: 'exists',
    nex: 'not_exists',
  }

  return mapping[op] || 'eq'
}

/**
 * Maps a unified operator to its Vercel equivalent, or `null` if Vercel has
 * no representation for it at all. Previously this defaulted any unmapped
 * operator to plain `eq` with no warning — silently changing what a rule
 * matches, sometimes inverting it outright (`ne` "is not X" became `eq` "is
 * X"). See #261.
 *
 * Returns `{ op, forceNeg }` rather than just `op`: Vercel has no dedicated
 * "not equal"/"does not contain"/"is not any of" operators, only positive
 * ones plus a `neg` flag (`VercelRuleOperator` in types/vercel.ts documents
 * the negative form each positive operator has via `neg`, except `ex`/`nex`,
 * which are already their own negated pair). `ne`/`not_contains`/`not_in`
 * are fully representable this way — `forceNeg: true` — but the caller must
 * compose that with the condition's own independent `negated` flag (XOR),
 * not just overwrite it with one or the other.
 *
 * `gt`/`ge`/`lt`/`le` have no entry and return `null`: Vercel's operator
 * vocabulary (`eq, pre, suf, inc, sub, re, ex, nex`) has no numeric
 * comparison concept at all, so there's nothing to fall back to — the caller
 * must drop the condition and warn rather than silently mis-map it to `eq`.
 */
function mapUnifiedOperatorToVercel(op: Operator): { op: VercelRuleOperator; forceNeg: boolean } | null {
  const mapping: Partial<Record<Operator, { op: VercelRuleOperator; forceNeg: boolean }>> = {
    eq: { op: 'eq', forceNeg: false },
    ne: { op: 'eq', forceNeg: true },
    starts_with: { op: 'pre', forceNeg: false },
    ends_with: { op: 'suf', forceNeg: false },
    in: { op: 'inc', forceNeg: false },
    not_in: { op: 'inc', forceNeg: true },
    contains: { op: 'sub', forceNeg: false },
    not_contains: { op: 'sub', forceNeg: true },
    matches: { op: 're', forceNeg: false },
    exists: { op: 'ex', forceNeg: false },
    not_exists: { op: 'nex', forceNeg: false },
  }

  return mapping[op] ?? null
}

/**
 * Maps a unified action type to Vercel's native action enum
 * (`VercelActionType`, types/vercel.ts) — a strict subset of the unified
 * `ActionType`. Previously `unifiedToVercel` used `rule.action.type`
 * directly with no mapping at all, so a rule with `action: {type: 'allow'}`
 * or `{type: 'block'}` passed doorman's own local validation (against the
 * wider unified schema) and was dispatched to Vercel's real API carrying a
 * `mitigate.action` value Vercel's own native schema says is invalid. See
 * #262.
 *
 * `allow` -> `bypass` (Vercel's closest equivalent: skip further mitigation,
 * i.e. let the request through) and `block` -> `deny` (Vercel's actual
 * block-like action) — both unconditional, meaning-preserving remaps rather
 * than lossy drops, so every unified `ActionType` has a real Vercel action
 * to land on and this never needs to warn or throw.
 */
function mapUnifiedActionToVercel(type: ActionType): VercelActionType {
  const mapping: Record<ActionType, VercelActionType> = {
    log: 'log',
    deny: 'deny',
    challenge: 'challenge',
    bypass: 'bypass',
    rate_limit: 'rate_limit',
    redirect: 'redirect',
    allow: 'bypass',
    block: 'deny',
  }

  return mapping[type]
}

/**
 * Vercel types with no entry here (e.g. `target_path`, `protocol`,
 * `environment`, `geo_continent`, `ja4_digest`, `ja3_digest`,
 * `rate_limit_api_id`) fall through to `mapping[type] || type` below and are
 * preserved as-is as the unified field name. `mapUnifiedTypeToVercel` (the
 * reverse direction) has an explicit entry for every one of those
 * pass-through fields so the round trip is lossless — keep the two in sync.
 *
 * `region` and `geo_country_region` are deliberately NOT among those
 * pass-through fields, for opposite reasons:
 *
 * - Vercel's `region` means the edge/deployment region a request is served
 *   from (e.g. `sfo1`), but the unified schema already has a `region`
 *   FieldType meaning something else entirely — the client's geographic
 *   subdivision (see `FieldType` in `types/common.ts`, mapped by
 *   Cloudflare's translator to `ip.geoip.subdivision_1`). Passing it through
 *   unchanged would silently collide with that field: the resulting
 *   condition looks like a valid client-geo check to every downstream
 *   translator, compiles with zero warnings, and just never matches
 *   anything (see #273). Mapped to the Vercel-namespaced `vercel_region`
 *   instead, which no other provider's field vocabulary uses — downstream
 *   translators with no mapping for it drop it with a warning.
 * - Vercel's `geo_country_region` is documented (`rules.md`) as "Region/state
 *   code", e.g. `"CA"` — the *same* real-world concept the unified `region`
 *   FieldType already names, unlike `region` above. So unlike the other
 *   pass-through fields, it maps directly to unified `region` rather than to
 *   a same- or Vercel-namespaced name — of the 8 fields #273 flagged, this
 *   is the one that turned out not to need external verification: it's an
 *   internal doorman-vocabulary match, not a claim about another provider's
 *   field names.
 */
function mapVercelTypeToUnified(type: string): string {
  const mapping: Record<string, string> = {
    host: 'host',
    path: 'path',
    method: 'method',
    header: 'header',
    query: 'query',
    cookie: 'cookie',
    ip_address: 'ip',
    user_agent: 'user_agent',
    geo_country: 'country',
    geo_city: 'city',
    geo_as_number: 'asn',
    scheme: 'scheme',
    region: 'vercel_region',
    geo_country_region: 'region',
  }

  return mapping[type] || type
}

/**
 * Unified condition fields with a Vercel condition-type equivalent. Covers
 * both the renamed unified fields (e.g. `ip` -> `ip_address`) and every
 * Vercel-native type `mapVercelTypeToUnified` passes through unchanged
 * (`protocol`, `environment`, `geo_continent`, `ja4_digest`, `ja3_digest`,
 * `rate_limit_api_id`, `target_path`) — those must map back to themselves,
 * not fall through to a default. `vercel_region` and `region` are the two
 * non-identity exceptions (see `mapVercelTypeToUnified`'s doc comment):
 * `vercel_region` maps back to Vercel's native `region`, and the real
 * unified `region` (client geo) maps to Vercel's `geo_country_region`, the
 * field that actually represents that concept on Vercel.
 */
const UNIFIED_TO_VERCEL_TYPE_MAP: Record<string, VercelRuleType> = {
  host: 'host',
  path: 'path',
  method: 'method',
  header: 'header',
  query: 'query',
  cookie: 'cookie',
  ip: 'ip_address',
  user_agent: 'user_agent',
  country: 'geo_country',
  city: 'geo_city',
  asn: 'geo_as_number',
  scheme: 'scheme',
  target_path: 'target_path',
  vercel_region: 'region',
  region: 'geo_country_region',
  protocol: 'protocol',
  environment: 'environment',
  geo_continent: 'geo_continent',
  ja4_digest: 'ja4_digest',
  ja3_digest: 'ja3_digest',
  rate_limit_api_id: 'rate_limit_api_id',
}

/**
 * Map a unified condition field to its Vercel condition type, or `null` if
 * Vercel has no equivalent (e.g. unified `referer`/`port`, which only
 * Cloudflare supports). Previously this defaulted unmapped fields to `'path'`,
 * which silently rewrote the *meaning* of a condition into a bogus path
 * match — with no warning — corrupting a live rule on every routine sync,
 * not just a cross-provider migration. Returning `null` lets the caller
 * (`unifiedToVercel`) drop the condition and warn instead.
 */
function mapUnifiedTypeToVercel(type: string): VercelRuleType | null {
  return UNIFIED_TO_VERCEL_TYPE_MAP[type] ?? null
}
