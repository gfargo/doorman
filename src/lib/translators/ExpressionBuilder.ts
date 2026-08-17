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
    const operator = this.mapVercelOperator(condition.op)
    const value = this.formatValue(condition.value, condition.op)

    let expression = `${field} ${operator} ${value}`

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

    const operator = this.mapUnifiedOperator(condition.operator)
    const value = this.formatValue(condition.value, operator)

    let expression = `${field} ${operator} ${value}`

    if (condition.negated) {
      expression = `not (${expression})`
    }

    return expression
  }

  /**
   * Map Vercel operators to Cloudflare operators
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
      nex: 'not exists',
    }

    return mapping[op] || op
  }

  /**
   * Map unified operators to Cloudflare operators
   */
  private static mapUnifiedOperator(op: string): string {
    const mapping: Record<string, string> = {
      eq: 'eq',
      ne: 'ne',
      contains: 'contains',
      not_contains: 'not contains',
      starts_with: 'starts_with',
      ends_with: 'ends_with',
      matches: 'matches',
      in: 'in',
      not_in: 'not in',
      gt: 'gt',
      ge: 'ge',
      lt: 'lt',
      le: 'le',
      exists: 'exists',
      not_exists: 'not exists',
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
