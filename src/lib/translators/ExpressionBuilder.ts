import type { VercelRuleCondition, VercelConditionGroup } from '../types/vercel'
import type { UnifiedCondition } from '../types/unified'
import { FieldMapper } from './FieldMapper'
import { escapeWirefilterString } from './wirefilterEscape'

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
      return `${operator} ${this.formatValue(condition.value, condition.op)}`
    })

    // Handle negation
    if (condition.neg) {
      expression = `not (${expression})`
    }

    return expression
  }

  /**
   * Build expression from unified conditions
   */
  public static fromUnifiedConditions(conditions: UnifiedCondition[], logic: 'AND' | 'OR' = 'AND'): string {
    if (!conditions || conditions.length === 0) {
      throw new Error('At least one condition is required')
    }

    const expressions = conditions.map((condition) => this.fromUnifiedCondition(condition))

    const connector = logic === 'AND' ? ' and ' : ' or '
    return expressions.length > 1 ? `(${expressions.join(connector)})` : expressions[0]!
  }

  /**
   * Build expression from a single unified condition
   */
  public static fromUnifiedCondition(condition: UnifiedCondition): string {
    const baseField = this.mapUnifiedFieldToCloudflare(condition.field)
    // `key` only makes sense as a bracket index for header/cookie fields
    // (matching FieldMapper's Vercel-side behavior) — a header or cookie
    // condition's key must not fall through to the headers field regardless
    // of which of the two it actually is.
    const field =
      condition.key && (condition.field === 'header' || condition.field === 'cookie')
        ? `${baseField}["${escapeWirefilterString(condition.key)}"]`
        : baseField

    let expression = this.buildUnifiedExpression(field, condition.operator, condition.value)

    if (condition.negated) {
      expression = `not (${expression})`
    }

    return expression
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
      return `not (${field} contains ${this.formatValue(value, 'contains')})`
    }
    if (op === 'not_in') {
      return `not (${field} in ${this.formatValue(value, 'in')})`
    }
    return this.buildExistsOrComparisonExpression(field, op, () => {
      const operator = this.mapUnifiedOperator(op)
      return `${operator} ${this.formatValue(value, operator)}`
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
   * Map unified field types to Cloudflare fields
   */
  private static mapUnifiedFieldToCloudflare(field: string): string {
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
    }

    return mapping[field] || field
  }

  /**
   * Format value for wirefilter expression
   */
  private static formatValue(value: unknown, _operator?: string): string {
    // Handle arrays (for 'in' operator)
    if (Array.isArray(value)) {
      const formattedValues = value.map((v) => this.formatSingleValue(v)).join(' ')
      return `{${formattedValues}}`
    }

    return this.formatSingleValue(value)
  }

  /**
   * Format a single value
   */
  private static formatSingleValue(value: unknown): string {
    if (typeof value === 'string') {
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
