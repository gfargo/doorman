import type { VercelRuleCondition, VercelConditionGroup } from '../types/vercel'
import type { UnifiedCondition } from '../types/unified'
import { FieldMapper } from './FieldMapper'
import { escapeWirefilterString } from './wirefilterEscape'
import { ipAddressSchema } from '../schemas/commonSchemas'

/**
 * wirefilter fields this codebase's field mappers ever produce that hold a
 * native `Ip` type rather than `String` — comparing one against a quoted
 * string literal is a type mismatch Cloudflare's ruleset API rejects.
 */
const UNQUOTED_IP_FIELDS = new Set(['ip.src'])

/**
 * Cloudflare fields that type as `Map<Array<String>>` rather than a scalar
 * `String` — indexing one yields an `Array<String>`, so a naive
 * `field["key"] eq "value"` is an Array-vs-String type mismatch the
 * Cloudflare API rejects (verified against Cloudflare's Ruleset Engine
 * field + function references, #263/#269). The correct idiom is
 * `any(field["key"][*] <op> value)` for comparisons, `has_key(field, "key")`
 * for existence — see `buildKeyedMapExpression`.
 *
 * `QUERY_ARGS_FIELD` is distinct from `http.request.uri.query` (the whole
 * query string, a scalar `String`); `HEADERS_FIELD` is Cloudflare's real
 * `header` field regardless of keying (there's no separate "all headers as
 * one value" concept, unlike cookie); `COOKIES_MAP_FIELD` is distinct from
 * `http.cookie` (the whole Cookie header as one scalar `String`, still used
 * for a non-keyed cookie condition) — `http.request.cookies` requires
 * Cloudflare Pro/Business/Enterprise (Ruleset Engine field reference), so
 * doorman emits it regardless and lets Cloudflare's API reject it on an
 * unsupported plan, the same policy already applied to `matches`/regex
 * (see cloudflare.md).
 */
const QUERY_ARGS_FIELD = 'http.request.uri.args'
const HEADERS_FIELD = 'http.request.headers'
const COOKIES_MAP_FIELD = 'http.request.cookies'

/**
 * Builds Cloudflare wirefilter expressions from structured conditions
 */
export class ExpressionBuilder {
  /**
   * Build expression from Vercel condition groups
   * Vercel uses OR between groups, AND within groups
   */
  public static fromVercelConditionGroups(conditionGroups: VercelConditionGroup[]): string {
    if (!conditionGroups || conditionGroups.length === 0) {
      throw new Error('At least one condition group is required')
    }

    // Build expression for each group (conditions are AND'd)
    const groupExpressions = conditionGroups.map((group) => {
      const conditions = group.conditions.map((condition) => this.fromVercelCondition(condition))
      if (conditions.length === 0) {
        throw new Error('Condition group must have at least one condition')
      }
      return conditions.length > 1 ? `(${conditions.join(' and ')})` : conditions[0]!
    })

    // OR between groups
    return groupExpressions.length > 1 ? groupExpressions.join(' or ') : groupExpressions[0]!
  }

  /**
   * Build expression from a single Vercel condition
   */
  public static fromVercelCondition(condition: VercelRuleCondition): string {
    const field = FieldMapper.toCloudflare(condition.type, condition.key)
    let expression = this.buildExistsOrComparisonExpression(field, condition.op, () => {
      const operator = this.mapVercelOperator(condition.op)
      return `${operator} ${this.formatValue(field, condition.value)}`
    })

    // Handle negation
    if (condition.neg) {
      expression = `not (${expression})`
    }

    return expression
  }

  /**
   * Build expression from unified conditions.
   *
   * Conditions may carry a `group` index — set when translated from a
   * provider with a two-level AND-within/OR-across condition model (e.g.
   * Vercel's `conditionGroup[]`, via RuleTranslator.vercelToUnified).
   * wirefilter fully supports arbitrary nesting, so conditions sharing a
   * `group` are AND'd, and each group's sub-expression is OR'd against the
   * others — without this, a rule with 2+ Vercel-originated groups would
   * flatten into one big AND/OR block and stop matching what it used to.
   * Ungrouped conditions (no `group` set on any of them, e.g. a
   * hand-authored config) fall back to the flat `logic`-joined behavior
   * this function has always had.
   */
  public static fromUnifiedConditions(conditions: UnifiedCondition[], logic: 'AND' | 'OR' = 'AND'): string {
    if (!conditions || conditions.length === 0) {
      throw new Error('At least one condition is required')
    }

    const hasGroups = conditions.some((c) => c.group !== undefined)
    if (!hasGroups) {
      const expressions = conditions.map((condition) => this.fromUnifiedCondition(condition))
      const connector = logic === 'AND' ? ' and ' : ' or '
      return expressions.length > 1 ? `(${expressions.join(connector)})` : expressions[0]!
    }

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

    const groupExpressions = Array.from(groupedConditions.values()).map((groupConditions) =>
      this.combineWithAnd(groupConditions.map((c) => this.fromUnifiedCondition(c))),
    )

    return groupExpressions.length > 1 ? this.combineWithOr(groupExpressions) : groupExpressions[0]!
  }

  /**
   * Build expression from a single unified condition
   */
  public static fromUnifiedCondition(condition: UnifiedCondition): string {
    // Keyed query/cookie conditions, and header conditions (always keyed —
    // see the throw below), can't reuse the generic bracket-index path
    // further down: their Cloudflare fields are `Map<Array<String>>` (see
    // the field-constants comment above `QUERY_ARGS_FIELD`), so they need
    // `buildKeyedMapExpression`'s `any(...)`/`has_key(...)` construct
    // instead of a bare bracket comparison.
    if (condition.key && condition.field === 'query') {
      return this.buildKeyedMapExpression(QUERY_ARGS_FIELD, condition.key, condition)
    }
    if (condition.field === 'header') {
      if (!condition.key) {
        // Unlike `cookie` below, `header` has no scalar "all headers as one
        // string" field to fall back to — Cloudflare's header field is a
        // Map, full stop — so a header condition genuinely needs to name
        // which header it means. Fail loudly rather than silently emit
        // `http.request.headers eq "..."`, comparing a Map against a String.
        throw new Error('A "header" condition requires a key naming the header')
      }
      // Cloudflare's header map is keyed by lowercased header name (Ruleset
      // Engine field reference, verified #269) — a mixed-case key would
      // silently never match otherwise, since `any()` over a missing map
      // entry is simply false, not an error.
      return this.buildKeyedMapExpression(HEADERS_FIELD, condition.key.toLowerCase(), condition)
    }
    if (condition.key && condition.field === 'cookie') {
      return this.buildKeyedMapExpression(COOKIES_MAP_FIELD, condition.key, condition)
    }

    const baseField = this.mapUnifiedFieldToCloudflare(condition.field)
    if (baseField === null) {
      // Should be unreachable: callers must filter with `isFieldSupported`
      // and warn before calling this. Throwing rather than interpolating
      // `null` (or falling back to the unmapped field name) keeps a future
      // caller that skips the filter from reintroducing #273 silently.
      throw new Error(
        `Unsupported condition field '${condition.field}' for Cloudflare — filter it out with a warning before calling fromUnifiedCondition (see unifiedToCloudflare).`,
      )
    }

    let expression = this.buildUnifiedExpression(baseField, condition.operator, condition.value)

    if (condition.negated) {
      expression = `not (${expression})`
    }

    return expression
  }

  /**
   * Builds a keyed comparison/exists expression against a Cloudflare
   * `Map<Array<String>>`-typed field's keyed entry — query args, headers,
   * or (Pro+) per-cookie values. See the field-constants comment above
   * `QUERY_ARGS_FIELD`. Mirrors Cloudflare's own documented idioms:
   * `any(field["key"][*] <op> value)` for value comparisons (an entry can
   * repeat, so this matches if *any* occurrence satisfies the operator) and
   * `has_key(field, "key")` for existence.
   */
  private static buildKeyedMapExpression(mapField: string, key: string, condition: UnifiedCondition): string {
    const escapedKey = escapeWirefilterString(key)
    const keyedField = `${mapField}["${escapedKey}"]`

    let expression: string
    if (condition.operator === 'exists') {
      expression = `has_key(${mapField}, "${escapedKey}")`
    } else if (condition.operator === 'not_exists') {
      expression = `not (has_key(${mapField}, "${escapedKey}"))`
    } else if (condition.operator === 'not_contains') {
      expression = `not (any(${keyedField}[*] contains ${this.formatValue(mapField, condition.value)}))`
    } else if (condition.operator === 'not_in') {
      expression = `not (any(${keyedField}[*] in ${this.formatValue(mapField, condition.value)}))`
    } else {
      const operator = this.mapUnifiedOperator(condition.operator)
      expression = `any(${keyedField}[*] ${operator} ${this.formatValue(mapField, condition.value)})`
    }

    return condition.negated ? `not (${expression})` : expression
  }

  /**
   * `exists`/`not_exists` (Vercel: `ex`/`nex`) conditions carry no value and
   * wirefilter has no `not exists` binary operator — negation must wrap the
   * whole unary `exists` check in `not (...)` instead. Every other operator
   * falls through to the caller's ordinary `<op> <value>` comparison.
   */
  private static buildExistsOrComparisonExpression(field: string, op: string, buildComparison: () => string): string {
    if (op === 'ex' || op === 'exists') {
      return `${field} exists`
    }
    if (op === 'nex' || op === 'not_exists') {
      return `not (${field} exists)`
    }
    return `${field} ${buildComparison()}`
  }

  /**
   * wirefilter also has no `not contains`/`not in` binary operators — like
   * `not_exists` above, these negated unified operators translate to the
   * positive comparison (`contains`/`in`) wrapped in `not (...)`.
   */
  private static buildUnifiedExpression(field: string, op: UnifiedCondition['operator'], value: unknown): string {
    if (op === 'not_contains') {
      return `not (${field} contains ${this.formatValue(field, value)})`
    }
    if (op === 'not_in') {
      return `not (${field} in ${this.formatValue(field, value)})`
    }
    return this.buildExistsOrComparisonExpression(field, op, () => {
      const operator = this.mapUnifiedOperator(op)
      return `${operator} ${this.formatValue(field, value)}`
    })
  }

  /**
   * Map Vercel operators to Cloudflare operators.
   * `ex` (and unified `exists`/`not_exists` below) are handled entirely by
   * `buildExistsOrComparisonExpression` before this is ever called — wirefilter
   * has no `not exists` binary operator, so `nex` is deliberately omitted here
   * rather than mapped to that invalid token.
   */
  private static mapVercelOperator(op: string): string {
    const mapping: Record<string, string> = {
      eq: 'eq',
      pre: 'starts_with',
      suf: 'ends_with',
      inc: 'in',
      sub: 'contains',
      re: 'matches',
      ex: 'exists',
    }

    return mapping[op] || op
  }

  /**
   * Map unified operators to Cloudflare operators.
   * `exists`/`not_exists`/`not_contains`/`not_in` are handled entirely by
   * `buildUnifiedExpression` before this is ever called — wirefilter has no
   * single-token `not exists`/`not contains`/`not in` operator, only
   * `not (<expr>)` wrapping a positive comparison — so those four are
   * deliberately omitted here rather than mapped to invalid tokens.
   */
  private static mapUnifiedOperator(op: string): string {
    const mapping: Record<string, string> = {
      eq: 'eq',
      ne: 'ne',
      contains: 'contains',
      starts_with: 'starts_with',
      ends_with: 'ends_with',
      matches: 'matches',
      in: 'in',
      gt: 'gt',
      ge: 'ge',
      lt: 'lt',
      le: 'le',
      exists: 'exists',
    }

    return mapping[op] || op
  }

  /**
   * Map unified field types to Cloudflare fields. Returns `null` for a field
   * with no Cloudflare equivalent (e.g. Vercel-only pass-through fields like
   * `vercel_region`, `environment`, `ja3_digest`) — mirrors the
   * `?? null` pattern `mapUnifiedTypeToVercel` (providers/vercel/translator.ts)
   * and `mapUnifiedFieldToFastly` (providers/fastly/translator.ts) already
   * use, rather than leaking an unmapped field name into the generated
   * wirefilter expression as a bare (invalid) identifier. See #273 — callers
   * must drop the condition and warn on `null`, not interpolate it; use
   * `isFieldSupported` to filter before calling `fromUnifiedCondition`.
   */
  private static mapUnifiedFieldToCloudflare(field: string): string | null {
    const mapping: Record<string, string> = {
      ip: 'ip.src',
      country: 'ip.geoip.country',
      region: 'ip.geoip.subdivision_1',
      city: 'ip.geoip.city',
      asn: 'ip.geoip.asnum',
      path: 'http.request.uri.path',
      host: 'http.host',
      method: 'http.request.method',
      header: 'http.request.headers',
      query: 'http.request.uri.query',
      cookie: 'http.cookie',
      user_agent: 'http.user_agent',
      referer: 'http.referer',
      scheme: 'ssl',
      port: 'cf.edge.server_port',
      // Added while fixing #273: this field's absence here meant an
      // unrelated pre-existing test ("threat_score" challenge rules) relied
      // on the exact bug #273 fixes (the removed `|| field` fallback) to
      // silently produce the invalid bare identifier `threat_score` instead
      // of throwing. `cf.threat_score` is Cloudflare's real field (also
      // independently declared in `CloudflareFieldType`, types/cloudflare.ts).
      threat_score: 'cf.threat_score',
    }

    return mapping[field] ?? null
  }

  /**
   * Whether a unified condition field has a Cloudflare equivalent. Callers
   * building a rule's conditions (e.g. `unifiedToCloudflare`) must filter out
   * unsupported fields — with a warning — before calling
   * `fromUnifiedCondition`/`fromUnifiedConditions`, which throw on one rather
   * than silently mistranslating it. See #273.
   */
  public static isFieldSupported(field: string): boolean {
    return this.mapUnifiedFieldToCloudflare(field) !== null
  }

  /**
   * Format value for wirefilter expression
   */
  private static formatValue(field: string, value: unknown): string {
    // Handle arrays (for 'in' operator)
    if (Array.isArray(value)) {
      const formattedValues = value.map((v) => this.formatSingleValue(field, v)).join(' ')
      return `{${formattedValues}}`
    }

    return this.formatSingleValue(field, value)
  }

  /**
   * Format a single value. IP-typed fields (ip.src) are wirefilter's native
   * `Ip` type, not `String` — comparing one against a quoted string literal
   * is a type mismatch Cloudflare's ruleset API rejects, so those values are
   * interpolated unquoted instead (mirrors RuleTranslator.unifiedIPToCloudflare's
   * dedicated IP-blocking-rule path). An unquoted value has no delimiter to
   * contain it — a more direct wirefilter-injection primitive than a quoted
   * string — so it's validated as a real IP/CIDR first and rejected otherwise.
   */
  private static formatSingleValue(field: string, value: unknown): string {
    if (typeof value === 'string') {
      if (UNQUOTED_IP_FIELDS.has(field)) {
        if (!ipAddressSchema.safeParse(value).success) {
          throw new Error(`Invalid IP address or CIDR range: ${value}`)
        }
        return value
      }
      return `"${escapeWirefilterString(value)}"`
    }

    if (typeof value === 'number') {
      return String(value)
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false'
    }

    return String(value)
  }

  /**
   * Validate generated expression
   */
  public static validate(expression: string): boolean {
    // Basic validation
    if (!expression || expression.trim().length === 0) {
      return false
    }

    // Check for balanced parentheses
    let depth = 0
    for (const char of expression) {
      if (char === '(') depth++
      if (char === ')') depth--
      if (depth < 0) return false
    }

    return depth === 0
  }

  /**
   * Combine multiple expressions with AND
   */
  public static combineWithAnd(expressions: string[]): string {
    if (expressions.length === 0) {
      throw new Error('At least one expression is required')
    }

    if (expressions.length === 1) {
      return expressions[0]!
    }

    return `(${expressions.join(' and ')})`
  }

  /**
   * Combine multiple expressions with OR
   */
  public static combineWithOr(expressions: string[]): string {
    if (expressions.length === 0) {
      throw new Error('At least one expression is required')
    }

    if (expressions.length === 1) {
      return expressions[0]!
    }

    return `(${expressions.join(' or ')})`
  }
}
