import type {
  FastlyRule,
  FastlyRuleInput,
  FastlyConditionOperator,
  FastlyConditionField,
  FastlyGroupOperator,
  FastlySingleCondition,
  FastlyMultivalCondition,
  FastlyGroupCondition,
  FastlyGroupConditionItem,
  FastlyAction,
  FastlyRateLimit,
  FastlyMultivalField,
} from '../../types/fastly'
import type { UnifiedRule, UnifiedIPRule, UnifiedCondition, UnifiedAction } from '../../types/unified'
import type { Operator } from '../../types/common'
import type { TranslationResult, TranslationWarning } from '../../translators/TranslationTypes'
import { TranslationWarningSystem } from '../../translators/TranslationWarningSystem'

/**
 * Fastly's half of the Fastly <-> Unified translation, following the same
 * per-adapter split as `vercel/translator.ts`/`cloudflare/translator.ts`
 * (#196).
 *
 * Fastly Next-Gen WAF's condition model is bounded to two levels — a rule's
 * top-level `conditions[]` holds `single`/`group`/`multival` items, and a
 * `group` item's own children are `single`/`multival` only (never a nested
 * group; confirmed by go-fastly's `GroupConditionItem` doc comment). That
 * maps directly onto `UnifiedCondition.group` (AND-within-group,
 * OR-across-groups) the same way Vercel's `conditionGroup[]` does — see
 * `buildFastlyConditions`/`extractUnifiedConditions` below.
 */

function logicWarning(ruleId: string | undefined, message: string, suggestion?: string): TranslationWarning {
  return TranslationWarningSystem.createWarning('complex_expressions', ruleId, undefined, message, suggestion)
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

const FASTLY_TO_UNIFIED_FIELD: Record<string, string> = {
  ip: 'ip',
  path: 'path',
  domain: 'host',
  method: 'method',
  country: 'country',
  scheme: 'scheme',
  user_agent: 'user_agent',
}

const UNIFIED_TO_FASTLY_FIELD: Record<string, FastlyConditionField> = {
  ip: 'ip',
  path: 'path',
  host: 'domain',
  method: 'method',
  country: 'country',
  scheme: 'scheme',
  user_agent: 'user_agent',
}

/** Unified condition fields that Fastly represents via a `multival` block rather than a single condition. */
const UNIFIED_TO_FASTLY_MULTIVAL_FIELD: Partial<Record<string, FastlyMultivalField>> = {
  header: 'request_header',
  query: 'query_parameter',
  cookie: 'request_cookie',
}

const FASTLY_MULTIVAL_TO_UNIFIED_FIELD: Record<FastlyMultivalField, string> = {
  request_header: 'header',
  query_parameter: 'query',
  request_cookie: 'cookie',
  // No unified field type covers these — passed through as-is (same
  // fallback philosophy as Vercel's `mapVercelTypeToUnified`) so a
  // fetch/download round trip doesn't lose the condition entirely, even
  // though doorman can't author a new one against these fields yet.
  response_header: 'response_header',
  post_parameter: 'post_parameter',
  signal: 'signal',
}

function mapFastlyFieldToUnified(field: string): string {
  return FASTLY_TO_UNIFIED_FIELD[field] ?? field
}

/** Returns `null` when Fastly has no single-condition equivalent (e.g. unified `region`/`city`/`asn`/`referer`/`port`). */
function mapUnifiedFieldToFastly(field: string): FastlyConditionField | null {
  return UNIFIED_TO_FASTLY_FIELD[field] ?? null
}

// ---------------------------------------------------------------------------
// Operator mapping
// ---------------------------------------------------------------------------

/**
 * Fastly carries negation as a distinct operator literal (`does_not_equal`
 * vs `equals`), while doorman's unified model carries it as a separate
 * `negated` boolean alongside a base operator — mirroring how
 * `vercelToUnified`/`unifiedToVercel` handle Vercel's `neg` flag. Mapping
 * here always resolves to unified's base-operator-plus-flag shape rather
 * than emitting `Operator`'s own `ne`/`not_contains`/`not_in` literals,
 * consistent with the fact no existing translator in this codebase emits
 * those either.
 */
const FASTLY_TO_UNIFIED_OPERATOR: Record<FastlyConditionOperator, { operator: Operator; negated: boolean }> = {
  equals: { operator: 'eq', negated: false },
  does_not_equal: { operator: 'eq', negated: true },
  contains: { operator: 'contains', negated: false },
  does_not_contain: { operator: 'contains', negated: true },
  // Fastly's "like" is wildcard (glob-style) matching, not a regex — closest
  // unified operator is still `matches`; flagged with the same
  // syntax-may-need-adjustment warning used for genuine regex below.
  like: { operator: 'matches', negated: false },
  not_like: { operator: 'matches', negated: true },
  in_list: { operator: 'in', negated: false },
  not_in_list: { operator: 'in', negated: true },
  matches: { operator: 'matches', negated: false },
  does_not_match: { operator: 'matches', negated: true },
  greater_equal: { operator: 'ge', negated: false },
  lesser_equal: { operator: 'le', negated: false },
}

function mapFastlyOperatorToUnified(op: FastlyConditionOperator): { operator: Operator; negated: boolean } {
  return FASTLY_TO_UNIFIED_OPERATOR[op] ?? { operator: 'eq', negated: false }
}

/**
 * Reverse direction. `startsWith`/`endsWith`/`gt`/`lt` have no exact Fastly
 * equivalent (Fastly's numeric comparisons are `>=`/`<=` only, and its
 * pattern operators don't distinguish prefix/suffix from general wildcard
 * matching) — mapped to the closest operator with a warning, same
 * drop-with-warning philosophy as an unmappable field, except these are
 * translatable-but-imprecise rather than untranslatable.
 */
function mapUnifiedOperatorToFastly(
  operator: Operator,
  negated: boolean | undefined,
  warnings: TranslationWarning[],
  ruleId: string | undefined,
): FastlyConditionOperator {
  switch (operator) {
    case 'eq':
      return negated ? 'does_not_equal' : 'equals'
    case 'ne':
      return 'does_not_equal'
    case 'contains':
      return negated ? 'does_not_contain' : 'contains'
    case 'not_contains':
      return 'does_not_contain'
    case 'starts_with':
    case 'ends_with':
      warnings.push(
        TranslationWarningSystem.createWarning(
          'regex_patterns',
          ruleId,
          undefined,
          `Unified operator "${operator}" has no direct Fastly equivalent — mapped to Fastly's wildcard "like" operator. Verify the translated value still matches as a wildcard pattern.`,
        ),
      )
      return negated ? 'not_like' : 'like'
    case 'matches':
      warnings.push(
        TranslationWarningSystem.createWarning(
          'regex_patterns',
          ruleId,
          undefined,
          'Regular expression pattern may need adjustment for Fastly Next-Gen WAF regex syntax.',
        ),
      )
      return negated ? 'does_not_match' : 'matches'
    case 'in':
      return negated ? 'not_in_list' : 'in_list'
    case 'not_in':
      return 'not_in_list'
    case 'gt':
      warnings.push(
        logicWarning(
          ruleId,
          'Unified operator "gt" (strictly greater than) has no Fastly equivalent — mapped to "greater_equal", which also matches the boundary value itself.',
        ),
      )
      return 'greater_equal'
    case 'ge':
      return 'greater_equal'
    case 'lt':
      warnings.push(
        logicWarning(
          ruleId,
          'Unified operator "lt" (strictly less than) has no Fastly equivalent — mapped to "lesser_equal", which also matches the boundary value itself.',
        ),
      )
      return 'lesser_equal'
    case 'le':
      return 'lesser_equal'
    default:
      return 'equals'
  }
}

// ---------------------------------------------------------------------------
// Fastly -> Unified
// ---------------------------------------------------------------------------

/**
 * Translates a Fastly rule's `conditions[]` into `UnifiedCondition[]`,
 * assigning each condition a `group` index so the AND-within/OR-across
 * shape survives the round trip. Only the shapes `unifiedToFastly` itself
 * produces (see `buildFastlyConditions`) translate back exactly; anything
 * else Fastly's API independently allows (e.g. loose conditions mixed with
 * groups) is flattened best-effort with a warning rather than silently
 * dropped.
 */
function extractUnifiedConditions(
  rule: FastlyRule,
  warnings: TranslationWarning[],
): { conditions: UnifiedCondition[]; conditionLogic: 'AND' | 'OR' } {
  const conditions: UnifiedCondition[] = []
  const groupItems = rule.conditions.filter((c) => c.type === 'group') as FastlyGroupCondition[]
  const looseItems = rule.conditions.filter((c) => c.type !== 'group') as Array<
    FastlySingleCondition | FastlyMultivalCondition
  >

  // The shape `unifiedToFastly` emits for a multi-group rule: every
  // top-level item is a group, ANDed internally, ORed across groups.
  if (groupItems.length > 0 && looseItems.length === 0 && rule.group_operator === 'any') {
    groupItems.forEach((group, groupIndex) => {
      if (group.group_operator !== 'all') {
        warnings.push(
          logicWarning(
            rule.id,
            'A condition group using "any" (OR) inside an outer "any" (OR) rule cannot be represented in doorman\'s flat AND-within/OR-across condition model — its members were kept in the same group (effectively AND\'d) instead of OR\'d. Review the translated rule against the original Fastly logic.',
          ),
        )
      }
      for (const item of group.conditions) {
        pushUnifiedCondition(conditions, item, groupIndex, warnings, rule.id)
      }
    })
    return { conditions, conditionLogic: groupItems.length > 1 ? 'OR' : 'AND' }
  }

  // Flat shape: every top-level item is a loose single/multival condition.
  if (groupItems.length === 0) {
    looseItems.forEach((item, index) => {
      const groupIndex = rule.group_operator === 'any' ? index : 0
      pushUnifiedCondition(conditions, item, groupIndex, warnings, rule.id)
    })
    return { conditions, conditionLogic: rule.group_operator === 'any' && looseItems.length > 1 ? 'OR' : 'AND' }
  }

  // Mixed shape doorman itself never emits (loose conditions alongside
  // groups, or an outer "all" wrapping groups) — best-effort flatten
  // everything into one AND'd group rather than dropping any of it.
  warnings.push(
    logicWarning(
      rule.id,
      `Rule mixes top-level conditions with condition groups under group_operator "${rule.group_operator}" — this doesn't fit doorman's flat AND-within/OR-across condition model. All conditions were combined with AND; review the translated rule against the original Fastly rule logic.`,
    ),
  )
  for (const item of looseItems) {
    pushUnifiedCondition(conditions, item, 0, warnings, rule.id)
  }
  for (const group of groupItems) {
    for (const item of group.conditions) {
      pushUnifiedCondition(conditions, item, 0, warnings, rule.id)
    }
  }
  return { conditions, conditionLogic: 'AND' }
}

function pushUnifiedCondition(
  conditions: UnifiedCondition[],
  item: FastlySingleCondition | FastlyMultivalCondition,
  group: number,
  warnings: TranslationWarning[],
  ruleId: string,
): void {
  if (item.type === 'single') {
    const { operator, negated } = mapFastlyOperatorToUnified(item.operator)
    conditions.push({
      field: mapFastlyFieldToUnified(item.field),
      operator,
      value: item.value,
      // Conditionally spread rather than `negated: negated || undefined` —
      // the latter still creates a `negated` key set to `undefined`, which
      // isn't the same object shape as omitting the key entirely as far as
      // `isDeepEqual`'s `Object.keys().length` check is concerned (it
      // compares key *count*, not just values). A local config round-tripped
      // through JSON (which drops `undefined` values) would then never
      // match a freshly-translated remote rule for the ordinary,
      // non-negated case — every sync would see a phantom "update" on every
      // rule, forever.
      ...(negated ? { negated: true } : {}),
      group,
    })
    return
  }

  const unifiedField = FASTLY_MULTIVAL_TO_UNIFIED_FIELD[item.field]
  const nameCondition = item.conditions.find((c) => c.field === 'name')
  const valueCondition = item.conditions.find((c) => c.field === 'value' || c.field === 'value_string')

  if (!valueCondition) {
    warnings.push(
      logicWarning(
        ruleId,
        `Multival condition on '${item.field}' has no value sub-condition doorman could extract (only a 'name' existence check) — skipped.`,
      ),
    )
    return
  }

  const { operator, negated } = mapFastlyOperatorToUnified(valueCondition.operator)
  conditions.push({
    field: unifiedField,
    operator,
    value: valueCondition.value,
    ...(negated ? { negated: true } : {}),
    ...(nameCondition ? { key: nameCondition.value } : {}),
    group,
  })
}

function mapFastlyActionToUnified(rule: FastlyRule, warnings: TranslationWarning[]): UnifiedAction {
  if (rule.actions.length > 1) {
    warnings.push(
      logicWarning(
        rule.id,
        `Rule has ${rule.actions.length} actions — doorman only models one action per rule; only the first ("${rule.actions[0]?.type}") was translated.`,
      ),
    )
  }
  const first = rule.actions[0]

  if (rule.type === 'rate_limit') {
    return {
      type: 'rate_limit',
      rateLimit: rule.rate_limit
        ? {
            requests: rule.rate_limit.threshold,
            window: `${rule.rate_limit.interval}s`,
            mitigationTimeout: rule.rate_limit.duration,
          }
        : undefined,
    }
  }

  switch (first?.type) {
    case 'block':
      return { type: 'block' }
    case 'allow':
      return { type: 'allow' }
    case 'browser_challenge':
    case 'dynamic_challenge':
    case 'verify_token':
      return { type: 'challenge' }
    case 'redirect':
      return {
        type: 'redirect',
        redirect: {
          location: first.redirect_url ?? '',
          ...(first.response_code !== undefined ? { statusCode: first.response_code } : {}),
        },
      }
    case 'add_signal':
    case 'exclude_signal':
    case 'deception':
      warnings.push(
        TranslationWarningSystem.createWarning(
          'action_differences',
          rule.id,
          'action.type',
          `Fastly action "${first.type}" tags or excludes a WAF signal rather than allowing/blocking the request — doorman has no matching action type. Mapped to "log" as the closest non-destructive fallback; review this rule.`,
        ),
      )
      return { type: 'log' }
    default:
      warnings.push(
        logicWarning(rule.id, `Unrecognised Fastly action type "${String(first?.type)}" — mapped to "log".`),
      )
      return { type: 'log' }
  }
}

/**
 * Translates a Fastly rule to Unified format.
 *
 * Only `type: 'request'` and `type: 'rate_limit'` rules should be passed
 * here — `signal`/`templated_signal` rules tag or exclude WAF signals
 * rather than allow/block/redirect a request, which has no faithful
 * `UnifiedAction` representation. `FastlyFirewallService.fetchConfig`
 * filters those out before calling this (with a debug log, not a
 * per-rule warning, since it's a rule *category* doorman doesn't manage
 * yet rather than a translation failure).
 */
export function fastlyToUnified(rule: FastlyRule): TranslationResult<UnifiedRule> {
  const warnings: TranslationWarning[] = []
  const { conditions, conditionLogic } = extractUnifiedConditions(rule, warnings)
  const action = mapFastlyActionToUnified(rule, warnings)

  if (conditions.length > 10) {
    warnings.push(
      TranslationWarningSystem.createWarning(
        'many_conditions',
        rule.id,
        undefined,
        `Rule has ${conditions.length} conditions which may impact performance`,
      ),
    )
  }

  const unifiedRule: UnifiedRule = {
    id: rule.id,
    // Fastly rules have no separate "name" field — `description` is the
    // only human-readable label available, so it fills both roles here.
    // `unifiedToFastly` writes it back out as `description`, which keeps a
    // name-only local rule stable across repeated syncs (see its warning
    // when a rule also sets a distinct `description`).
    name: rule.description || rule.id,
    enabled: rule.enabled,
    conditions,
    conditionLogic,
    action,
  }

  return { result: unifiedRule, warnings }
}

// ---------------------------------------------------------------------------
// Unified -> Fastly
// ---------------------------------------------------------------------------

interface BuiltFastlyConditions {
  conditions: FastlySingleCondition[]
  groupConditions: FastlyGroupCondition[]
  multivalConditions: FastlyMultivalCondition[]
  groupOperator: FastlyGroupOperator
}

/**
 * Groups unified conditions by their `group` index (see
 * `buildVercelConditionGroups` for the Vercel equivalent this mirrors) into
 * Fastly's three-array `CreateInput`/`UpdateInput` shape. A single implicit
 * group (or no `group` set at all) becomes flat top-level conditions with
 * `group_operator: 'all'` (AND everything) — the common case. Two or more
 * groups become Fastly `group` items, each `group_operator: 'all'`
 * internally, with the rule's own `group_operator` set to `'any'` (OR
 * across groups) — this is the one shape `extractUnifiedConditions` above
 * can translate back losslessly.
 */
function buildFastlyConditions(
  conditions: UnifiedCondition[],
  ruleId: string | undefined,
  warnings: TranslationWarning[],
): BuiltFastlyConditions {
  const grouped = new Map<number, UnifiedCondition[]>()
  for (const condition of conditions) {
    const groupIndex = condition.group ?? 0
    const bucket = grouped.get(groupIndex)
    if (bucket) {
      bucket.push(condition)
    } else {
      grouped.set(groupIndex, [condition])
    }
  }

  const mapOne = (condition: UnifiedCondition): FastlySingleCondition | FastlyMultivalCondition | null => {
    const multivalField = UNIFIED_TO_FASTLY_MULTIVAL_FIELD[condition.field]
    if (multivalField) {
      if (condition.key === undefined) {
        warnings.push(
          logicWarning(
            ruleId,
            `Condition on '${condition.field}' has no 'key' set — Fastly needs a specific ${condition.field} name to match on (e.g. a header name). Skipped.`,
          ),
        )
        return null
      }
      const valueField =
        multivalField === 'request_header' || multivalField === 'response_header' ? 'value_string' : 'value'
      return {
        type: 'multival',
        field: multivalField,
        operator: 'exists',
        group_operator: 'all',
        conditions: [
          { type: 'single', field: 'name', operator: 'equals', value: condition.key },
          {
            type: 'single',
            field: valueField,
            operator: mapUnifiedOperatorToFastly(condition.operator, condition.negated, warnings, ruleId),
            value: String(condition.value),
          },
        ],
      }
    }

    const field = mapUnifiedFieldToFastly(condition.field)
    if (!field) {
      warnings.push(
        TranslationWarningSystem.createUnsupportedFeatureWarning(
          `condition field '${condition.field}'`,
          'unified config',
          'Fastly',
          ruleId,
          condition.field,
        ),
      )
      return null
    }
    return {
      type: 'single',
      field,
      operator: mapUnifiedOperatorToFastly(condition.operator, condition.negated, warnings, ruleId),
      value: String(condition.value),
    }
  }

  if (grouped.size <= 1) {
    const items = conditions.map(mapOne).filter((c): c is FastlySingleCondition | FastlyMultivalCondition => c !== null)
    return {
      conditions: items.filter((i): i is FastlySingleCondition => i.type === 'single'),
      groupConditions: [],
      multivalConditions: items.filter((i): i is FastlyMultivalCondition => i.type === 'multival'),
      groupOperator: 'all',
    }
  }

  const groupConditions: FastlyGroupCondition[] = []
  for (const groupConditionList of grouped.values()) {
    const items = groupConditionList.map(mapOne).filter((c): c is FastlyGroupConditionItem => c !== null)
    if (items.length > 0) {
      groupConditions.push({ type: 'group', group_operator: 'all', conditions: items })
    }
  }
  return { conditions: [], groupConditions, multivalConditions: [], groupOperator: 'any' }
}

function buildFastlyAction(
  action: UnifiedAction,
  warnings: TranslationWarning[],
  ruleId: string | undefined,
): FastlyAction {
  switch (action.type) {
    case 'block':
    case 'deny':
      return { type: 'block' }
    case 'allow':
      return { type: 'allow' }
    case 'challenge':
      return { type: 'browser_challenge' }
    case 'bypass':
      warnings.push(
        logicWarning(ruleId, 'Unified action "bypass" has no direct Fastly equivalent — mapped to "allow".'),
      )
      return { type: 'allow' }
    case 'log':
      warnings.push(
        logicWarning(
          ruleId,
          'Unified action "log" has no dedicated Fastly action — mapped to "allow" (request_logging is enabled at the rule level regardless).',
        ),
      )
      return { type: 'allow' }
    case 'redirect':
      if (!action.redirect) {
        warnings.push(logicWarning(ruleId, 'Unified action "redirect" has no redirect target — mapped to "allow".'))
        return { type: 'allow' }
      }
      return {
        type: 'redirect',
        redirect_url: action.redirect.location,
        response_code: action.redirect.statusCode ?? (action.redirect.permanent ? 301 : 302),
      }
    case 'rate_limit':
      // The rule-level `type` (set by the caller) already carries the
      // rate-limit-ness; Fastly's rate-limit action enum is a distinct,
      // smaller set from request-rule actions — `block_signal` is its
      // block-on-breach analogue.
      return { type: 'block_signal' }
    default:
      warnings.push(
        TranslationWarningSystem.createUnsupportedFeatureWarning(
          `action type '${action.type}'`,
          'unified config',
          'Fastly',
          ruleId,
          'action.type',
        ),
      )
      return { type: 'block' }
  }
}

/**
 * Parses a unified rate-limit `window` string (e.g. `"60s"`, `"5m"`,
 * `"1h"`) into seconds, then rounds to the nearest interval Fastly accepts
 * (60, 600, or 3600 seconds — confirmed by the `fastly_ngwaf_workspace_rule`
 * Terraform schema). Any rounding is reported as a warning rather than
 * applied silently, since it changes the rate limit's actual behavior.
 */
function mapWindowToFastlyInterval(window: string, warnings: TranslationWarning[], ruleId: string | undefined): number {
  const match = /^(\d+)\s*(s|m|h)?$/i.exec(window.trim())
  const multiplier = { s: 1, m: 60, h: 3600 } as const
  const seconds = match ? Number(match[1]) * multiplier[(match[2]?.toLowerCase() as 's' | 'm' | 'h') || 's'] : NaN

  const allowed = [60, 600, 3600]
  if (!Number.isFinite(seconds) || seconds <= 0) {
    warnings.push(
      TranslationWarningSystem.createWarning(
        'rate_limiting_precision',
        ruleId,
        undefined,
        `Rate limit window "${window}" could not be parsed — defaulted to Fastly's 60-second interval.`,
      ),
    )
    return 60
  }

  const nearest = allowed.reduce((best, candidate) =>
    Math.abs(candidate - seconds) < Math.abs(best - seconds) ? candidate : best,
  )
  if (nearest !== seconds) {
    warnings.push(
      TranslationWarningSystem.createWarning(
        'rate_limiting_precision',
        ruleId,
        undefined,
        `Rate limit window "${window}" (${seconds}s) isn't one of Fastly's supported intervals (60s/600s/3600s) — rounded to ${nearest}s.`,
      ),
    )
  }
  return nearest
}

function buildFastlyRateLimit(
  rateLimit: UnifiedAction['rateLimit'],
  ruleId: string | undefined,
  warnings: TranslationWarning[],
): FastlyRateLimit {
  if (!rateLimit) {
    throw new Error(
      `Rule "${ruleId ?? '(unnamed)'}" has action type "rate_limit" but no rateLimit configuration — Fastly requires a threshold and interval.`,
    )
  }

  const interval = mapWindowToFastlyInterval(rateLimit.window, warnings, ruleId)
  warnings.push(
    TranslationWarningSystem.createWarning(
      'rate_limiting_precision',
      ruleId,
      undefined,
      'Fastly rate-limit rules count requests against a named custom signal, which doorman does not create automatically — ' +
        `create a signal named "doorman-rate-limit-${ruleId ?? 'rule'}" in this workspace before syncing, or the rule will be rejected.`,
    ),
  )

  return {
    client_identifiers: [{ type: 'ip' }],
    duration: rateLimit.mitigationTimeout ?? interval,
    interval,
    signal: `doorman-rate-limit-${ruleId ?? 'rule'}`,
    threshold: rateLimit.requests,
  }
}

/**
 * Translates a Unified rule to Fastly's rule-input format.
 */
export function unifiedToFastly(rule: UnifiedRule): TranslationResult<FastlyRuleInput> {
  const warnings: TranslationWarning[] = []

  if (rule.description && rule.description !== rule.name) {
    warnings.push(
      logicWarning(
        rule.id,
        'Fastly rules have no separate "name" field — only "description" carries over, and it was set from this rule\'s ' +
          '`name`. The `description` text was dropped rather than merged in, to keep it round-trip-stable on the next sync.',
      ),
    )
  }

  const { conditions, groupConditions, multivalConditions, groupOperator } = buildFastlyConditions(
    rule.conditions,
    rule.id,
    warnings,
  )

  if (conditions.length === 0 && groupConditions.length === 0 && multivalConditions.length === 0) {
    throw new Error(
      `Rule "${rule.name}" has no conditions Fastly can represent — every condition field is unsupported by Fastly. ` +
        'Cannot sync this rule to Fastly.',
    )
  }

  const isRateLimit = rule.action.type === 'rate_limit'

  const result: FastlyRuleInput = {
    type: isRateLimit ? 'rate_limit' : 'request',
    description: rule.name,
    enabled: rule.enabled,
    group_operator: groupOperator,
    request_logging: 'sampled',
    conditions,
    group_conditions: groupConditions,
    multival_conditions: multivalConditions,
    actions: [buildFastlyAction(rule.action, warnings, rule.id)],
    rate_limit: isRateLimit ? buildFastlyRateLimit(rule.action.rateLimit, rule.id, warnings) : null,
  }

  return { result, warnings }
}

// ---------------------------------------------------------------------------
// IP lists
// ---------------------------------------------------------------------------

/**
 * Fastly has no per-IP-rule resource like Vercel/Cloudflare — IP
 * allow/block-listing is done via a `list` of type `ip` (a flat array of
 * entries, replaced wholesale on write, the same atomic-replace shape as
 * Cloudflare's ruleset). `FastlyFirewallService` maintains one list per
 * action (`deny`/`allow`) and translates each list's `entries[]` here.
 *
 * `hostname`/`notes` (both Vercel/Cloudflare-only per-IP metadata) have no
 * Fastly equivalent — dropped with a warning rather than silently
 * discarded, same as an unmappable condition field.
 */
export function fastlyListEntriesToUnified(entries: string[], action: 'deny' | 'allow'): UnifiedIPRule[] {
  return entries.map((ip) => ({ ip, action }))
}

export function unifiedIPsToFastlyEntries(ips: UnifiedIPRule[]): TranslationResult<{
  denyEntries: string[]
  allowEntries: string[]
}> {
  const warnings: TranslationWarning[] = []
  const denyEntries: string[] = []
  const allowEntries: string[] = []

  for (const ip of ips) {
    if (ip.hostname || ip.notes) {
      warnings.push(
        logicWarning(
          ip.id,
          `IP rule "${ip.ip}" sets ${ip.hostname ? '`hostname`' : ''}${ip.hostname && ip.notes ? ' and ' : ''}${ip.notes ? '`notes`' : ''} — Fastly IP lists have no equivalent per-entry metadata; only the address was kept.`,
        ),
      )
    }
    ;(ip.action === 'allow' ? allowEntries : denyEntries).push(ip.ip)
  }

  return { result: { denyEntries, allowEntries }, warnings }
}
