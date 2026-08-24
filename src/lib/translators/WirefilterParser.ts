import type { UnifiedCondition } from '../types/unified'
import { unescapeWirefilterString } from './wirefilterEscape'
import { TokenStream, ParseError } from './TokenStream'
import { orGroupsToConditions } from './orGroupsToConditions'

/**
 * Parses a Cloudflare wirefilter expression back into `UnifiedCondition[]`.
 *
 * doorman only ever *writes* wirefilter expressions via `ExpressionBuilder`,
 * so this is deliberately the inverse of that generator rather than a
 * general-purpose wirefilter parser — it understands exactly the grammar
 * subset `ExpressionBuilder` can produce (field/op/value comparisons,
 * `exists`, `not (...)` wrapping a single comparison/exists, `and`/`or`
 * joins, one level of AND-within-groups OR-across-groups nesting, bracket
 * key access for a plain field, `any(field["key"][*] op value)`/
 * `has_key(field, "key")` for a keyed query/header/cookie condition (#269),
 * `{...}` set values, quoted-string escaping). Anything outside that
 * subset — a hand-authored expression, or one from another tool — is
 * reported as unsupported (`null`) rather than guessed at, so a caller can
 * fall back to a clearly-flagged lossy conversion instead of silently
 * misrepresenting what the rule matches.
 */

// wirefilter field path -> unified condition field. Inverse of
// ExpressionBuilder's private `mapUnifiedFieldToCloudflare` table, plus the
// keyed `Map<Array<String>>` fields `buildKeyedMapExpression` uses inside
// `any(...)`/`has_key(...)` calls (`http.request.uri.args`,
// `http.request.cookies` — see parseAnyCall/parseHasKeyCall) — keep all of
// this in sync with ExpressionBuilder.
const CLOUDFLARE_FIELD_TO_UNIFIED: Record<string, string> = {
  'ip.src': 'ip',
  'ip.geoip.country': 'country',
  'ip.geoip.subdivision_1': 'region',
  'ip.geoip.city': 'city',
  'ip.geoip.asnum': 'asn',
  'http.request.uri.path': 'path',
  'http.host': 'host',
  'http.request.method': 'method',
  'http.request.headers': 'header',
  'http.request.uri.query': 'query',
  'http.request.uri.args': 'query',
  'http.cookie': 'cookie',
  'http.request.cookies': 'cookie',
  'http.user_agent': 'user_agent',
  'http.referer': 'referer',
  ssl: 'scheme',
  'cf.edge.server_port': 'port',
  'cf.threat_score': 'threat_score',
}

const COMPARISON_OPERATORS = new Set([
  'eq',
  'ne',
  'contains',
  'starts_with',
  'ends_with',
  'matches',
  'in',
  'gt',
  'ge',
  'lt',
  'le',
])

const BOOLEAN_CONNECTIVES = new Set(['and', 'or', 'not'])

type TokenType = 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE' | 'LBRACKET' | 'RBRACKET' | 'STRING' | 'WORD'

interface Token {
  type: TokenType
  value: string
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = expression.length

  while (i < len) {
    const ch = expression[i]!

    if (/\s/.test(ch)) {
      i++
      continue
    }

    // Argument separator inside a function call (`has_key(field, "key")`)
    // — the only place a bare `,` appears in anything ExpressionBuilder
    // generates. No dedicated token type needed: skipped exactly like
    // whitespace, since parseHasKeyCall consumes its two arguments
    // positionally rather than validating comma placement.
    if (ch === ',') {
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
    if (ch === '{') {
      tokens.push({ type: 'LBRACE', value: ch })
      i++
      continue
    }
    if (ch === '}') {
      tokens.push({ type: 'RBRACE', value: ch })
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

    if (ch === '"') {
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
        if (expression[j] === '"') {
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
      tokens.push({ type: 'STRING', value: unescapeWirefilterString(raw) })
      i = j
      continue
    }

    // A maximal run of anything that isn't whitespace or a structural
    // character — covers field paths, keywords, operators, numbers, and
    // bare (unquoted) IP/CIDR literals uniformly. `,` is structural too
    // (see above) so a run stops before it instead of swallowing it, e.g.
    // `has_key(http.request.headers, "x")` tokenizes the field as
    // `http.request.headers`, not `http.request.headers,`.
    let j = i
    while (j < len && !/[\s(){}[\]",]/.test(expression[j]!)) {
      j++
    }
    if (j === i) {
      throw new ParseError(`Unexpected character '${ch}' at position ${i}`)
    }
    tokens.push({ type: 'WORD', value: expression.slice(i, j) })
    i = j
  }

  return tokens
}

type WirefilterNode =
  | { type: 'and'; children: WirefilterNode[] }
  | { type: 'or'; children: WirefilterNode[] }
  | { type: 'not'; child: WirefilterNode }
  | { type: 'exists'; field: string; key?: string }
  | { type: 'comparison'; field: string; key?: string; operator: string; value: string | number | (string | number)[] }

type WirefilterTokenStream = TokenStream<TokenType, Token>

function parseOr(stream: WirefilterTokenStream): WirefilterNode {
  const children = [parseAnd(stream)]
  while (stream.is('WORD', 'or')) {
    stream.next()
    children.push(parseAnd(stream))
  }
  return children.length === 1 ? children[0]! : { type: 'or', children }
}

function parseAnd(stream: WirefilterTokenStream): WirefilterNode {
  const children = [parseUnary(stream)]
  while (stream.is('WORD', 'and')) {
    stream.next()
    children.push(parseUnary(stream))
  }
  return children.length === 1 ? children[0]! : { type: 'and', children }
}

function parseUnary(stream: WirefilterTokenStream): WirefilterNode {
  if (stream.is('WORD', 'not')) {
    stream.next()
    stream.expect('LPAREN')
    const inner = parseOr(stream)
    stream.expect('RPAREN')
    return { type: 'not', child: inner }
  }
  return parsePrimary(stream)
}

function parsePrimary(stream: WirefilterTokenStream): WirefilterNode {
  const token = stream.peek()
  if (token && token.type === 'LPAREN') {
    stream.next()
    const inner = parseOr(stream)
    stream.expect('RPAREN')
    return inner
  }
  return parseComparisonOrExists(stream)
}

function parseFieldRef(stream: WirefilterTokenStream): { field: string; key?: string } {
  const fieldToken = stream.expect('WORD')
  if (BOOLEAN_CONNECTIVES.has(fieldToken.value)) {
    throw new ParseError(`Expected a field reference but got keyword '${fieldToken.value}'`)
  }

  if (stream.peek()?.type === 'LBRACKET') {
    stream.next()
    const keyToken = stream.expect('STRING')
    stream.expect('RBRACKET')
    return { field: fieldToken.value, key: keyToken.value }
  }

  return { field: fieldToken.value }
}

function parseValueSingle(stream: WirefilterTokenStream): string | number {
  const token = stream.next()
  if (token.type === 'STRING') {
    return token.value
  }
  if (token.type === 'WORD') {
    if (/^-?\d+(\.\d+)?$/.test(token.value)) {
      return Number(token.value)
    }
    // Bare token: an unquoted IP/CIDR literal, or any other unquoted
    // wirefilter atom (e.g. `true`/`false`) — preserved as its literal text.
    return token.value
  }
  throw new ParseError(`Unexpected token '${token.value}' where a value was expected`)
}

function parseValue(stream: WirefilterTokenStream): string | number | (string | number)[] {
  if (stream.peek()?.type === 'LBRACE') {
    stream.next()
    const values: (string | number)[] = []
    while (stream.peek()?.type !== 'RBRACE') {
      values.push(parseValueSingle(stream))
    }
    stream.expect('RBRACE')
    return values
  }
  return parseValueSingle(stream)
}

/**
 * Parses `any(FIELD["key"][*] OP VALUE)` — the wirefilter idiom for a value
 * comparison against a keyed entry of a `Map<Array<String>>`-typed field
 * (header/cookie/query — see ExpressionBuilder.buildKeyedMapExpression,
 * #263/#269). Produces the same `comparison` node shape the plain
 * bracket-index path in `parseComparisonOrExists` already does, so
 * `leafToCondition`/`isLeaf`/`orGroupsToConditions` need no changes to
 * understand it — negation (`not (any(...))`) falls out of the existing
 * top-level `not (...)` handling in `parseUnary` for free, since this is
 * still ordinary recursive descent.
 */
function parseAnyCall(stream: WirefilterTokenStream): WirefilterNode {
  stream.next() // 'any', already confirmed by the caller's stream.is check
  stream.expect('LPAREN')
  const fieldToken = stream.expect('WORD')
  stream.expect('LBRACKET')
  const keyToken = stream.expect('STRING')
  stream.expect('RBRACKET')
  stream.expect('LBRACKET')
  const star = stream.expect('WORD')
  if (star.value !== '*') {
    throw new ParseError(`Expected '*' in any(...) array index but got '${star.value}'`)
  }
  stream.expect('RBRACKET')

  const opToken = stream.next()
  if (opToken.type !== 'WORD' || !COMPARISON_OPERATORS.has(opToken.value)) {
    throw new ParseError(`Unsupported or unrecognized operator '${opToken.value}' inside any(...)`)
  }
  const value = parseValue(stream)
  stream.expect('RPAREN')

  return { type: 'comparison', field: fieldToken.value, key: keyToken.value, operator: opToken.value, value }
}

/**
 * Parses `has_key(FIELD, "key")` — the wirefilter idiom for an existence
 * check against a keyed entry of a `Map<Array<String>>`-typed field. See
 * `parseAnyCall`.
 */
function parseHasKeyCall(stream: WirefilterTokenStream): WirefilterNode {
  stream.next() // 'has_key', already confirmed by the caller's stream.is check
  stream.expect('LPAREN')
  const fieldToken = stream.expect('WORD')
  const keyToken = stream.expect('STRING') // the tokenizer skips the separating ',' like whitespace
  stream.expect('RPAREN')

  return { type: 'exists', field: fieldToken.value, key: keyToken.value }
}

function parseComparisonOrExists(stream: WirefilterTokenStream): WirefilterNode {
  if (stream.is('WORD', 'any')) {
    return parseAnyCall(stream)
  }
  if (stream.is('WORD', 'has_key')) {
    return parseHasKeyCall(stream)
  }

  const { field, key } = parseFieldRef(stream)

  if (stream.is('WORD', 'exists')) {
    stream.next()
    return { type: 'exists', field, key }
  }

  const opToken = stream.next()
  if (opToken.type !== 'WORD' || !COMPARISON_OPERATORS.has(opToken.value)) {
    throw new ParseError(`Unsupported or unrecognized operator '${opToken.value}'`)
  }

  const value = parseValue(stream)
  return { type: 'comparison', field, key, operator: opToken.value, value }
}

function parseExpression(expression: string): WirefilterNode {
  const stream = new TokenStream(tokenize(expression))
  const node = parseOr(stream)
  if (!stream.atEnd()) {
    throw new ParseError('Unexpected trailing tokens')
  }
  return node
}

/** A leaf is a single condition — a comparison, an exists check, or one level of `not (...)` wrapping either. */
function isLeaf(node: WirefilterNode): boolean {
  if (node.type === 'comparison' || node.type === 'exists') return true
  if (node.type === 'not') return node.child.type === 'comparison' || node.child.type === 'exists'
  return false
}

function leafToCondition(node: WirefilterNode, group: number): UnifiedCondition | null {
  const negated = node.type === 'not'
  const inner = node.type === 'not' ? node.child : node
  if (inner.type !== 'comparison' && inner.type !== 'exists') {
    return null
  }

  const mappedField = CLOUDFLARE_FIELD_TO_UNIFIED[inner.field]
  if (!mappedField) {
    return null
  }

  if (inner.type === 'exists') {
    return {
      field: mappedField,
      operator: negated ? 'not_exists' : 'exists',
      value: '',
      key: inner.key,
      group,
    }
  }

  // Prefer the dedicated "not_X" operator over a generic `negated` flag when
  // one exists — `not (field contains "x")` and `not (field in {...})` are
  // exactly what `not_contains`/`not_in` generate; every other operator has
  // no dedicated negative form, so those fall back to `negated: true`.
  let operator = inner.operator
  let isNegated: boolean | undefined
  if (negated) {
    if (inner.operator === 'contains') {
      operator = 'not_contains'
    } else if (inner.operator === 'in') {
      operator = 'not_in'
    } else {
      isNegated = true
    }
  }

  return {
    field: mappedField,
    operator: operator as UnifiedCondition['operator'],
    value: inner.value as UnifiedCondition['value'],
    key: inner.key,
    negated: isNegated,
    group,
  }
}

/**
 * Converts a parsed AST into `UnifiedCondition[]`, restricted to the shapes
 * `ExpressionBuilder` itself produces: a flat AND, a flat OR, or a top-level
 * OR of AND-groups (Vercel's two-level condition model). Anything else
 * (OR nested inside AND, `not` wrapping a non-leaf, an unmapped field) is
 * outside that subset and reported as `null`.
 */
function astToConditions(
  node: WirefilterNode,
): { conditions: UnifiedCondition[]; conditionLogic: 'AND' | 'OR' } | null {
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
    return orGroupsToConditions(
      node.children,
      isLeaf,
      (child): child is Extract<WirefilterNode, { type: 'and' }> => child.type === 'and',
      leafToCondition,
    )
  }

  return null
}

export interface WirefilterParseResult {
  conditions: UnifiedCondition[]
  conditionLogic: 'AND' | 'OR'
}

/**
 * Parses a wirefilter expression into `UnifiedCondition[]`, or returns
 * `null` if the expression falls outside the grammar subset this parser
 * understands (syntax error, or a structure `ExpressionBuilder` never
 * generates). Never throws.
 */
export function parseWirefilterExpression(expression: string): WirefilterParseResult | null {
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
