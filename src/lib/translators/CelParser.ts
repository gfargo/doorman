import type { UnifiedCondition } from '../types/unified'
import { unescapeCelString } from './celEscape'

/**
 * Parses a Google Cloud Armor CEL expression back into `UnifiedCondition[]`.
 *
 * Same discipline as `WirefilterParser` (#178): doorman only ever *writes*
 * CEL via `CelExpressionBuilder`, so this is deliberately the inverse of
 * that generator, not a general-purpose CEL parser. It understands exactly
 * the grammar subset the builder can produce — `has(...)`/`inIpRange(...)`
 * function calls, `field == value` and friends, `.contains()`/
 * `.startsWith()`/`.endsWith()`/`.matches()` method calls, `field in
 * [...]`, `&&`/`||`/`!`, bracket key access, and the guarded
 * `(has(x) && ...)` shape every header-backed condition uses. Anything
 * outside that subset — hand-authored CEL, or another tool's — is reported
 * as unsupported (`null`) rather than guessed at.
 *
 * One inherent, documented lossy case: a *keyed* cookie condition
 * (`{field: 'cookie', key: 'session', value: 'abc', operator: 'eq'}`)
 * compiles to a `.contains('session=abc')` check — CEL has no parsed
 * cookie map, so there is no CEL shape that distinguishes "this specific
 * cookie's value" from "this substring happens to appear in the header".
 * Parsing it back yields `{field: 'cookie', value: 'session=abc', operator:
 * 'contains'}` — behaviorally identical (re-building it produces the exact
 * same CEL), but cosmetically different from the original. This is a real
 * boundary of what Cloud Armor can express, not a parser bug.
 */

// CEL field path (+ optional bracket key) -> unified field. Exact inverse of
// CelExpressionBuilder's SIMPLE_FIELD_MAP/HEADER_BACKED_FIELDS — keep in sync.
const SIMPLE_CEL_FIELD_TO_UNIFIED: Record<string, string> = {
  'origin.region_code': 'country',
  'origin.asn': 'asn',
  'request.path': 'path',
  'request.method': 'method',
  'request.query': 'query',
}

const HEADER_KEY_TO_UNIFIED_FIELD: Record<string, string> = {
  host: 'host',
  'user-agent': 'user_agent',
  referer: 'referer',
  cookie: 'cookie',
}

const METHOD_TO_OPERATOR: Record<string, UnifiedCondition['operator']> = {
  contains: 'contains',
  startsWith: 'starts_with',
  endsWith: 'ends_with',
  matches: 'matches',
}

type TokenType =
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'DOT'
  | 'STRING'
  | 'NUMBER'
  | 'IDENT'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'EQ'
  | 'NE'
  | 'GT'
  | 'GE'
  | 'LT'
  | 'LE'

interface Token {
  type: TokenType
  value: string
}

class ParseError extends Error {}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = expression.length

  const two = (a: string, b: string): boolean => expression[i] === a && expression[i + 1] === b

  while (i < len) {
    const ch = expression[i]!

    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: ch })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ch })
      i++
      continue
    }
    if (ch === '[') {
      tokens.push({ type: 'LBRACKET', value: ch })
      i++
      continue
    }
    if (ch === ']') {
      tokens.push({ type: 'RBRACKET', value: ch })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ch })
      i++
      continue
    }
    if (two('&', '&')) {
      tokens.push({ type: 'AND', value: '&&' })
      i += 2
      continue
    }
    if (two('|', '|')) {
      tokens.push({ type: 'OR', value: '||' })
      i += 2
      continue
    }
    if (two('=', '=')) {
      tokens.push({ type: 'EQ', value: '==' })
      i += 2
      continue
    }
    if (two('!', '=')) {
      tokens.push({ type: 'NE', value: '!=' })
      i += 2
      continue
    }
    if (two('>', '=')) {
      tokens.push({ type: 'GE', value: '>=' })
      i += 2
      continue
    }
    if (two('<', '=')) {
      tokens.push({ type: 'LE', value: '<=' })
      i += 2
      continue
    }
    if (ch === '!') {
      tokens.push({ type: 'NOT', value: '!' })
      i++
      continue
    }
    if (ch === '>') {
      tokens.push({ type: 'GT', value: '>' })
      i++
      continue
    }
    if (ch === '<') {
      tokens.push({ type: 'LT', value: '<' })
      i++
      continue
    }
    // A DOT is only ever a field-path/method separator in this grammar
    // subset — a bare '.' is never reachable while scanning a NUMBER below,
    // since that branch consumes any '.' itself.
    if (ch === '.') {
      tokens.push({ type: 'DOT', value: ch })
      i++
      continue
    }

    if (ch === "'") {
      let j = i + 1
      let raw = ''
      let closed = false
      while (j < len) {
        const current = expression[j]!
        if (current === '\\' && j + 1 < len) {
          raw += current + expression[j + 1]!
          j += 2
          continue
        }
        if (expression[j] === "'") {
          closed = true
          j++
          break
        }
        raw += expression[j]
        j++
      }
      if (!closed) {
        throw new ParseError('Unterminated string literal')
      }
      tokens.push({ type: 'STRING', value: unescapeCelString(raw) })
      i = j
      continue
    }

    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(expression[i + 1] ?? ''))) {
      let j = i + 1
      while (j < len && /[0-9.]/.test(expression[j]!)) j++
      tokens.push({ type: 'NUMBER', value: expression.slice(i, j) })
      i = j
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < len && /[A-Za-z0-9_]/.test(expression[j]!)) j++
      tokens.push({ type: 'IDENT', value: expression.slice(i, j) })
      i = j
      continue
    }

    throw new ParseError(`Unexpected character '${ch}' at position ${i}`)
  }

  return tokens
}

class TokenStream {
  pos = 0
  constructor(private tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  next(): Token {
    const token = this.tokens[this.pos]
    if (!token) {
      throw new ParseError('Unexpected end of expression')
    }
    this.pos++
    return token
  }

  expect(type: TokenType): Token {
    const token = this.next()
    if (token.type !== type) {
      throw new ParseError(`Expected ${type} but got '${token.value}'`)
    }
    return token
  }

  isIdent(value: string): boolean {
    const token = this.peek()
    return !!token && token.type === 'IDENT' && token.value === value
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length
  }
}

interface FieldRef {
  field: string
  key?: string
}

type CelNode =
  | { type: 'and'; children: CelNode[] }
  | { type: 'or'; children: CelNode[] }
  | { type: 'not'; child: CelNode }
  | ({ type: 'has' } & FieldRef)
  | { type: 'inIpRange'; value: string }
  | ({ type: 'comparison'; operator: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'; value: string | number } & FieldRef)
  | ({ type: 'methodCall'; method: string; value: string } & FieldRef)
  | ({ type: 'membership'; values: (string | number)[] } & FieldRef)

/** A dotted field path, stopping before a trailing `.method(` — that's a method-call suffix, parsed separately. */
function parseFieldPath(stream: TokenStream): string {
  let path = stream.expect('IDENT').value
  while (stream.peek()?.type === 'DOT') {
    const savedPos = stream.pos
    stream.next() // consume DOT
    const identTok = stream.expect('IDENT')
    if (stream.peek()?.type === 'LPAREN') {
      stream.pos = savedPos
      break
    }
    path += `.${identTok.value}`
  }
  return path
}

function parseFieldRef(stream: TokenStream): FieldRef {
  const field = parseFieldPath(stream)
  if (stream.peek()?.type === 'LBRACKET') {
    stream.next()
    const key = stream.expect('STRING')
    stream.expect('RBRACKET')
    return { field, key: key.value }
  }
  return { field }
}

function parseLiteral(stream: TokenStream): string | number {
  const token = stream.next()
  if (token.type === 'STRING') return token.value
  if (token.type === 'NUMBER') return Number(token.value)
  throw new ParseError(`Unexpected token '${token.value}' where a literal was expected`)
}

function parseLeaf(stream: TokenStream): CelNode {
  if (stream.isIdent('has')) {
    stream.next()
    stream.expect('LPAREN')
    const ref = parseFieldRef(stream)
    stream.expect('RPAREN')
    return { type: 'has', ...ref }
  }

  if (stream.isIdent('inIpRange')) {
    stream.next()
    stream.expect('LPAREN')
    const ref = parseFieldRef(stream)
    if (ref.field !== 'origin.ip') {
      throw new ParseError(`inIpRange must reference origin.ip, got '${ref.field}'`)
    }
    stream.expect('COMMA')
    const value = stream.expect('STRING')
    stream.expect('RPAREN')
    return { type: 'inIpRange', value: value.value }
  }

  const ref = parseFieldRef(stream)

  if (stream.peek()?.type === 'DOT') {
    stream.next()
    const method = stream.expect('IDENT').value
    if (!METHOD_TO_OPERATOR[method]) {
      throw new ParseError(`Unrecognized method '${method}'`)
    }
    stream.expect('LPAREN')
    const value = stream.expect('STRING')
    stream.expect('RPAREN')
    return { type: 'methodCall', ...ref, method, value: value.value }
  }

  if (stream.isIdent('in')) {
    stream.next()
    stream.expect('LBRACKET')
    const values: (string | number)[] = []
    while (stream.peek()?.type !== 'RBRACKET') {
      values.push(parseLiteral(stream))
      if (stream.peek()?.type === 'COMMA') stream.next()
    }
    stream.expect('RBRACKET')
    return { type: 'membership', ...ref, values }
  }

  const opToken = stream.next()
  const OP_MAP: Partial<Record<TokenType, 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'>> = {
    EQ: 'eq',
    NE: 'ne',
    GT: 'gt',
    GE: 'ge',
    LT: 'lt',
    LE: 'le',
  }
  const operator = OP_MAP[opToken.type]
  if (!operator) {
    throw new ParseError(`Unexpected token '${opToken.value}' after field reference`)
  }
  const value = parseLiteral(stream)
  return { type: 'comparison', ...ref, operator, value }
}

function parsePrimary(stream: TokenStream): CelNode {
  if (stream.peek()?.type === 'LPAREN') {
    stream.next()
    const inner = parseOr(stream)
    stream.expect('RPAREN')
    return inner
  }
  return parseLeaf(stream)
}

function parseUnary(stream: TokenStream): CelNode {
  if (stream.peek()?.type === 'NOT') {
    stream.next()
    return { type: 'not', child: parsePrimary(stream) }
  }
  return parsePrimary(stream)
}

function parseAnd(stream: TokenStream): CelNode {
  const children = [parseUnary(stream)]
  while (stream.peek()?.type === 'AND') {
    stream.next()
    children.push(parseUnary(stream))
  }
  return children.length === 1 ? children[0]! : { type: 'and', children }
}

function parseOr(stream: TokenStream): CelNode {
  const children = [parseAnd(stream)]
  while (stream.peek()?.type === 'OR') {
    stream.next()
    children.push(parseAnd(stream))
  }
  return children.length === 1 ? children[0]! : { type: 'or', children }
}

function parseExpression(expression: string): CelNode {
  const stream = new TokenStream(tokenize(expression))
  const node = parseOr(stream)
  if (!stream.atEnd()) {
    throw new ParseError('Unexpected trailing tokens')
  }
  return node
}

/** A leaf that's a single ip check — one `inIpRange(...)` or `origin.ip == '...'`. */
function isIpCheckLeaf(
  node: CelNode,
): node is Extract<CelNode, { type: 'inIpRange' }> | Extract<CelNode, { type: 'comparison' }> {
  if (node.type === 'inIpRange') return true
  if (node.type === 'comparison' && node.field === 'origin.ip' && node.operator === 'eq') return true
  return false
}

/** `(ipCheck || ipCheck || ...)` — CelExpressionBuilder's shape for an ip condition with multiple CIDR/IP values. */
function isIpOrGroup(node: CelNode): node is Extract<CelNode, { type: 'or' }> {
  return node.type === 'or' && node.children.length > 0 && node.children.every(isIpCheckLeaf)
}

function ipCheckValue(
  node: Extract<CelNode, { type: 'inIpRange' }> | Extract<CelNode, { type: 'comparison' }>,
): string {
  return node.type === 'inIpRange' ? node.value : String(node.value)
}

/** `(has(field[key]) && <comparison|methodCall|membership on the same field[key], possibly negated>)`. */
function isGuardedLeaf(node: CelNode): boolean {
  if (node.type !== 'and' || node.children.length !== 2) return false
  const guard = node.children[0]!
  const inner = node.children[1]!
  if (guard.type !== 'has') return false
  const innerNode = inner.type === 'not' ? inner.child : inner
  if (!('field' in innerNode) || innerNode.field !== guard.field || innerNode.key !== guard.key) return false
  return innerNode.type === 'comparison' || innerNode.type === 'methodCall' || innerNode.type === 'membership'
}

/** Extracts the `has(...)` guard and the (possibly `not`-wrapped) inner comparison from a node `isGuardedLeaf` already confirmed. */
function unwrapGuardedLeaf(node: Extract<CelNode, { type: 'and' }>): {
  guard: Extract<CelNode, { type: 'has' }>
  comparisonNegated: boolean
  comparison: CelNode
} {
  const guard = node.children[0] as Extract<CelNode, { type: 'has' }>
  const inner = node.children[1]!
  const comparisonNegated = inner.type === 'not'
  const comparison = comparisonNegated ? (inner as Extract<CelNode, { type: 'not' }>).child : inner
  return { guard, comparisonNegated, comparison }
}

/** A leaf is a single condition: any recognized comparison shape, the ip-multi-value OR, the guarded shape, or a `not` wrapping one of those. */
function isLeaf(node: CelNode): boolean {
  if (
    node.type === 'has' ||
    node.type === 'comparison' ||
    node.type === 'methodCall' ||
    node.type === 'membership' ||
    node.type === 'inIpRange'
  ) {
    return true
  }
  if (isIpOrGroup(node)) return true
  if (isGuardedLeaf(node)) return true
  if (node.type === 'not') {
    const inner = node.child
    return (
      inner.type === 'has' ||
      inner.type === 'comparison' ||
      inner.type === 'methodCall' ||
      inner.type === 'membership' ||
      inner.type === 'inIpRange' ||
      isIpOrGroup(inner)
    )
  }
  return false
}

/** Maps a CEL field(+key) reference to doorman's unified field name, or `null` if unrecognized. */
function mapFieldToUnified(
  field: string,
  key: string | undefined,
): { unifiedField: string; unifiedKey?: string } | null {
  if (field === 'origin.ip') return { unifiedField: 'ip' }
  const simple = SIMPLE_CEL_FIELD_TO_UNIFIED[field]
  if (simple) return { unifiedField: simple }
  if (field === 'request.headers' && key !== undefined) {
    const backed = HEADER_KEY_TO_UNIFIED_FIELD[key]
    if (backed) return { unifiedField: backed }
    return { unifiedField: 'header', unifiedKey: key }
  }
  return null
}

function leafToCondition(node: CelNode, group: number): UnifiedCondition | null {
  const negated = node.type === 'not'
  const inner = node.type === 'not' ? node.child : node

  if (isIpOrGroup(inner)) {
    const values = inner.children.map((c) => ipCheckValue(c as Extract<CelNode, { type: 'inIpRange' | 'comparison' }>))
    return { field: 'ip', operator: negated ? 'not_in' : 'in', value: values, group }
  }

  if (inner.type === 'inIpRange' || (inner.type === 'comparison' && inner.field === 'origin.ip')) {
    const value = inner.type === 'inIpRange' ? inner.value : String(inner.value)
    return { field: 'ip', operator: negated ? 'ne' : 'eq', value, group }
  }

  if (inner.type === 'and' && isGuardedLeaf(inner)) {
    // The outer `negated` (a `not` wrapping the whole guarded AND) never
    // happens from CelExpressionBuilder — negation for these lives *inside*
    // the guard (`has(x) && !comparison`) — so a guarded leaf reached with
    // `negated: true` here is outside the grammar subset this parser
    // understands.
    if (negated) return null
    const { guard, comparisonNegated, comparison } = unwrapGuardedLeaf(inner)
    if (comparison.type !== 'comparison' && comparison.type !== 'methodCall' && comparison.type !== 'membership') {
      return null
    }
    return comparisonToCondition(comparison, comparisonNegated, guard.field, guard.key, group)
  }

  if (inner.type === 'comparison' || inner.type === 'methodCall' || inner.type === 'membership') {
    return comparisonToCondition(inner, negated, inner.field, inner.key, group)
  }

  if (inner.type === 'has') {
    const mapped = mapFieldToUnified(inner.field, inner.key)
    if (!mapped) return null
    return {
      field: mapped.unifiedField,
      operator: negated ? 'not_exists' : 'exists',
      value: '',
      key: mapped.unifiedKey,
      group,
    }
  }

  return null
}

function comparisonToCondition(
  node: Extract<CelNode, { type: 'comparison' | 'methodCall' | 'membership' }>,
  negated: boolean,
  refField: string,
  refKey: string | undefined,
  group: number,
): UnifiedCondition | null {
  const mapped = mapFieldToUnified(refField, refKey)
  if (!mapped) return null

  let operator: UnifiedCondition['operator']
  let value: string | number | string[] | number[]

  if (node.type === 'comparison') {
    operator = negated ? negateSimpleOperator(node.operator) : node.operator
    value = node.value
  } else if (node.type === 'methodCall') {
    const base = METHOD_TO_OPERATOR[node.method]
    if (!base) return null
    operator = negated ? (`not_${base}` as UnifiedCondition['operator']) : base
    // Only 'contains'/'not_contains' have a dedicated negative form in the
    // unified operator set — the builder never negates startsWith/endsWith/
    // matches, so this is unreachable for those methods in practice.
    if (negated && operator !== 'not_contains') return null
    value = node.value
  } else {
    operator = negated ? 'not_in' : 'in'
    value = node.values as string[] | number[]
  }

  return {
    field: mapped.unifiedField,
    operator,
    value,
    key: mapped.unifiedKey,
    group,
  }
}

function negateSimpleOperator(op: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'): UnifiedCondition['operator'] {
  // CelExpressionBuilder never emits a `not`-wrapped bare comparison (`eq`
  // negates to the native `!=` operator, not `!(field == x)`) — reachable
  // only for a hand-authored expression using this codebase's grammar
  // subset in a way the builder itself wouldn't. `ne` is the sole case with
  // an obvious inverse; anything else has no single-operator negation.
  if (op === 'eq') return 'ne'
  if (op === 'ne') return 'eq'
  throw new ParseError(`No negated form for comparison operator '${op}'`)
}

/**
 * Converts a parsed AST into `UnifiedCondition[]`, restricted to the shapes
 * `CelExpressionBuilder` itself produces: a flat AND, a flat OR, or a
 * top-level OR of AND-groups. Anything else is outside that subset and
 * reported as `null`.
 */
function astToConditions(node: CelNode): { conditions: UnifiedCondition[]; conditionLogic: 'AND' | 'OR' } | null {
  if (isLeaf(node)) {
    const condition = leafToCondition(node, 0)
    return condition ? { conditions: [condition], conditionLogic: 'AND' } : null
  }

  if (node.type === 'and') {
    const conditions: UnifiedCondition[] = []
    for (const child of node.children) {
      if (!isLeaf(child)) return null
      const condition = leafToCondition(child, 0)
      if (!condition) return null
      conditions.push(condition)
    }
    return { conditions, conditionLogic: 'AND' }
  }

  if (node.type === 'or') {
    const conditions: UnifiedCondition[] = []
    node.children.forEach((child, groupIndex) => {
      if (isLeaf(child)) {
        const condition = leafToCondition(child, groupIndex)
        if (condition) conditions.push(condition)
        return
      }
      if (child.type === 'and') {
        for (const grandchild of child.children) {
          if (!isLeaf(grandchild)) return
          const condition = leafToCondition(grandchild, groupIndex)
          if (condition) conditions.push(condition)
        }
      }
    })
    const expectedGroups = node.children.length
    const actualGroups = new Set(conditions.map((c) => c.group)).size
    if (actualGroups !== expectedGroups) return null
    return { conditions, conditionLogic: 'OR' }
  }

  return null
}

export interface CelParseResult {
  conditions: UnifiedCondition[]
  conditionLogic: 'AND' | 'OR'
}

/**
 * Parses a Cloud Armor CEL expression into `UnifiedCondition[]`, or returns
 * `null` if the expression falls outside the grammar subset this parser
 * understands. Never throws.
 */
export function parseCelExpression(expression: string): CelParseResult | null {
  if (!expression || !expression.trim()) {
    return null
  }
  try {
    const ast = parseExpression(expression)
    return astToConditions(ast)
  } catch {
    return null
  }
}
