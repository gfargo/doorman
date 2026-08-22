import type { UnifiedCondition } from '../types/unified'
import { escapeCelString } from './celEscape'
import { ipAddressSchema } from '../schemas/commonSchemas'

/**
 * Fields Cloud Armor's CEL vocabulary genuinely has no equivalent for, so a
 * condition using one must fail loudly rather than be silently dropped or
 * approximated. Confirmed against Cloud Armor's rules-language-reference —
 * no continent/region/city-level geo attribute exists at all (only
 * country-level `origin.region_code`), and no per-request port attribute
 * exists (Cloud Armor operates at L7 behind a load balancer whose listening
 * port isn't a per-request WAF-rule concern). `scheme` is deliberately
 * omitted here too, pending confirmation of the actual CEL field name —
 * safer to reject than to guess and emit something Cloud Armor rejects.
 */
const UNSUPPORTED_FIELDS = new Set(['region', 'city', 'port', 'scheme'])

/**
 * Fields that resolve to a `request.headers[...]` map lookup rather than a
 * dedicated top-level field. Indexing an absent key throws a CEL runtime
 * evaluation error (confirmed against Cloud Armor's own examples, which
 * uniformly guard with `has(...)` first), so every one of these needs a
 * `has(...) &&` prefix — see `buildHeaderCondition`.
 */
const HEADER_BACKED_FIELDS: Record<string, string> = {
  host: 'host',
  user_agent: 'user-agent',
  referer: 'referer',
}

/**
 * Builds Google Cloud Armor CEL expressions (`rule.match.expr.expression`)
 * from `UnifiedCondition[]`, mirroring `ExpressionBuilder`'s structure for
 * Cloudflare wirefilter — same AND-within-group/OR-across-groups grouping,
 * same per-condition dispatch shape, different target grammar.
 *
 * Deliberately flat-only: Cloud Armor's real-world CEL usage is single-level
 * boolean chains (confirmed via research on #187), so unlike wirefilter this
 * never needs to represent an OR nested inside an AND — every group's
 * conditions are AND'd, and groups are OR'd, exactly like Vercel's
 * `conditionGroup[]` model this already mirrors for Cloudflare.
 */
export class CelExpressionBuilder {
  /**
   * Build a CEL expression from unified conditions. See
   * `ExpressionBuilder.fromUnifiedConditions`'s doc comment for the grouping
   * semantics this mirrors exactly.
   */
  public static fromUnifiedConditions(conditions: UnifiedCondition[], logic: 'AND' | 'OR' = 'AND'): string {
    if (!conditions || conditions.length === 0) {
      throw new Error('At least one condition is required')
    }

    const hasGroups = conditions.some((c) => c.group !== undefined)
    if (!hasGroups) {
      const expressions = conditions.map((condition) => this.fromUnifiedCondition(condition))
      const connector = logic === 'AND' ? ' && ' : ' || '
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
   * Build a CEL fragment from a single unified condition.
   */
  public static fromUnifiedCondition(condition: UnifiedCondition): string {
    if (UNSUPPORTED_FIELDS.has(condition.field)) {
      throw new Error(
        `Cloud Armor has no CEL equivalent for the "${condition.field}" condition field — this rule cannot be represented and would otherwise be silently dropped.`,
      )
    }

    if (condition.field === 'ip') {
      return this.buildIpCondition(condition)
    }

    if (condition.field === 'cookie') {
      return this.buildCookieCondition(condition)
    }

    const headerKey = HEADER_BACKED_FIELDS[condition.field]
    if (headerKey) {
      return this.buildHeaderCondition(headerKey, condition)
    }

    if (condition.field === 'header' || condition.field === 'query') {
      if (condition.field === 'header') {
        if (!condition.key) {
          throw new Error('A "header" condition requires a key naming the header')
        }
        return this.buildHeaderCondition(condition.key, condition)
      }
      // Cloud Armor exposes only the raw, undecoded query string
      // (`request.query`) — no parsed per-parameter map, confirmed against
      // the rules-language-reference. Always present (possibly empty), so
      // no has() guard is needed, unlike the header-backed fields above.
      return this.buildComparison('request.query', condition, false)
    }

    const simpleField = SIMPLE_FIELD_MAP[condition.field]
    if (simpleField) {
      return this.buildComparison(simpleField.path, condition, simpleField.numeric)
    }

    throw new Error(`Cloud Armor CEL builder has no mapping for condition field "${condition.field}"`)
  }

  /**
   * `ip` conditions target `origin.ip`. A CIDR value (contains `/`) must use
   * the dedicated `inIpRange()` function — CEL has no `in`-with-a-set-of-
   * ranges operator the way wirefilter's `ip.src in {...}` does, so an
   * `in`/`eq` condition with multiple CIDR values becomes an OR of
   * individual `inIpRange()` calls. A bare IP (no `/`) uses plain `==`.
   */
  private static buildIpCondition(condition: UnifiedCondition): string {
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(String)
    if (values.length === 0 || values.some((v) => !v)) {
      throw new Error('An "ip" condition requires at least one value')
    }

    const checks = values.map((value) => {
      if (!ipAddressSchema.safeParse(value).success) {
        throw new Error(`Invalid IP address or CIDR range: ${value}`)
      }
      return value.includes('/')
        ? `inIpRange(origin.ip, '${escapeCelString(value)}')`
        : `origin.ip == '${escapeCelString(value)}'`
    })

    const negated = condition.operator === 'not_in' || condition.operator === 'ne'

    if (checks.length > 1) {
      const combined = `(${checks.join(' || ')})`
      return negated ? `!${combined}` : combined
    }

    // A single check: `inIpRange(...)` is a function call, so `!` directly
    // negates its boolean result with no ambiguity. A bare `origin.ip ==
    // '...'` is NOT — CEL's `!` binds tighter than `==`, so `!origin.ip ==
    // 'x'` would parse as `(!origin.ip) == 'x'`, a type error against a
    // string. Needs explicit parens around the comparison before negating.
    const check = checks[0]!
    if (!negated) return check
    return check.startsWith('inIpRange(') ? `!${check}` : `!(${check})`
  }

  /**
   * A condition against a `request.headers[...]` map entry (an actual
   * header, or one of the header-backed pseudo-fields — host/user-agent/
   * referer/cookie all live in the headers map in Cloud Armor's model, there
   * being no dedicated field for any of them). Every access is guarded with
   * `has(...)` first, since indexing an absent key is a CEL runtime error,
   * not an empty-string read.
   *
   * `exists`/`not_exists` map directly onto the guard itself. Every other
   * operator is guarded *and* compared — deliberately: "header does not
   * contain X" on a request where the header is entirely absent is treated
   * as false (the header-negation rule doesn't apply to requests it can't
   * even evaluate against), not vacuously true.
   */
  private static buildHeaderCondition(headerKey: string, condition: UnifiedCondition): string {
    const field = `request.headers['${escapeCelString(headerKey)}']`
    const guard = `has(${field})`

    if (condition.operator === 'exists') return guard
    if (condition.operator === 'not_exists') return `!${guard}`

    return `(${guard} && ${this.buildComparison(field, condition, false)})`
  }

  /**
   * Cloud Armor has no parsed per-cookie map — only the raw `Cookie` header
   * string (confirmed against rules-language-reference: unlike a real cookie
   * jar, there is nothing resembling `request.cookies['name']`). Without a
   * `key`, a cookie condition checks the whole header, same as
   * `buildHeaderCondition`. *With* a `key` — the common case, "is this
   * specific cookie set to this value" — this composes a `key=value`
   * substring and searches for it in the raw header, since that's the only
   * thing CEL can actually check; `eq`/`ne`/`contains`/`not_contains` are
   * the only operators where that composition is unambiguous (a `key`
   * without a value, or `starts_with`/`matches`/etc. against a synthesized
   * substring, doesn't have one obvious meaning) — anything else throws
   * rather than emitting a check that looks precise but isn't.
   */
  private static buildCookieCondition(condition: UnifiedCondition): string {
    const field = `request.headers['cookie']`
    const guard = `has(${field})`

    if (condition.operator === 'exists') return guard
    if (condition.operator === 'not_exists') return `!${guard}`

    if (!condition.key) {
      return `(${guard} && ${this.buildComparison(field, condition, false)})`
    }

    if (!['eq', 'ne', 'contains', 'not_contains'].includes(condition.operator)) {
      throw new Error(
        `Cloud Armor can only check a specific cookie's value via substring search (has no parsed cookie map) — "${condition.operator}" on a keyed cookie condition has no unambiguous CEL representation.`,
      )
    }

    const pair = `${condition.key}=${String(condition.value)}`
    const check = `${field}.contains('${escapeCelString(pair)}')`
    const negated = condition.operator === 'ne' || condition.operator === 'not_contains'
    return `(${guard} && ${negated ? `!${check}` : check})`
  }

  /**
   * A plain comparison against a field CEL always exposes directly (no
   * `has()` guard needed) — string fields (`==`, `.contains()`,
   * `.startsWith()`, `.endsWith()`, `.matches()`, `in [...]`) or the one
   * numeric field (`asn`, via `==`/`>`/`>=`/`<`/`<=`).
   */
  private static buildComparison(field: string, condition: UnifiedCondition, numeric: boolean): string {
    const { operator, value } = condition

    if (operator === 'exists' || operator === 'not_exists') {
      // Every field routed here is always present on the request (unlike
      // the header-backed fields, which never reach this branch for these
      // two operators — see buildHeaderCondition) — so existence is
      // trivially always true/false rather than a meaningful check.
      throw new Error(`"${operator}" is not meaningful for Cloud Armor's "${field}" — it is always present`)
    }

    if (operator === 'in' || operator === 'not_in') {
      const values = Array.isArray(value) ? value : [value]
      const list = values.map((v) => this.formatLiteral(v, numeric)).join(', ')
      const expr = `${field} in [${list}]`
      return operator === 'not_in' ? `!(${expr})` : expr
    }

    const literal = this.formatLiteral(value, numeric)

    switch (operator) {
      case 'eq':
        return `${field} == ${literal}`
      case 'ne':
        return `${field} != ${literal}`
      case 'contains':
        return `${field}.contains(${literal})`
      case 'not_contains':
        return `!${field}.contains(${literal})`
      case 'starts_with':
        return `${field}.startsWith(${literal})`
      case 'ends_with':
        return `${field}.endsWith(${literal})`
      case 'matches':
        return `${field}.matches(${literal})`
      case 'gt':
        return `${field} > ${literal}`
      case 'ge':
        return `${field} >= ${literal}`
      case 'lt':
        return `${field} < ${literal}`
      case 'le':
        return `${field} <= ${literal}`
      default:
        throw new Error(`Cloud Armor CEL builder has no mapping for operator "${operator}"`)
    }
  }

  private static formatLiteral(value: unknown, numeric: boolean): string {
    if (numeric) {
      const n = Number(value)
      if (!Number.isFinite(n)) {
        throw new Error(`Expected a numeric value, got "${String(value)}"`)
      }
      return String(n)
    }
    return `'${escapeCelString(String(value))}'`
  }

  /**
   * Combine multiple CEL fragments with `&&`.
   */
  public static combineWithAnd(expressions: string[]): string {
    if (expressions.length === 0) {
      throw new Error('At least one expression is required')
    }
    return expressions.length === 1 ? expressions[0]! : `(${expressions.join(' && ')})`
  }

  /**
   * Combine multiple CEL fragments with `||`.
   */
  public static combineWithOr(expressions: string[]): string {
    if (expressions.length === 0) {
      throw new Error('At least one expression is required')
    }
    return expressions.length === 1 ? expressions[0]! : `(${expressions.join(' || ')})`
  }
}

const SIMPLE_FIELD_MAP: Record<string, { path: string; numeric: boolean }> = {
  country: { path: 'origin.region_code', numeric: false },
  asn: { path: 'origin.asn', numeric: true },
  path: { path: 'request.path', numeric: false },
  method: { path: 'request.method', numeric: false },
}
