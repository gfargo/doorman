/**
 * Escapes a string for safe interpolation into a single-quoted CEL string
 * literal (Cloud Armor's `rule.match.expr.expression`), e.g.
 * `request.headers['<key>']` or a condition value like `'<value>'`.
 *
 * Backslashes must be escaped *before* quotes — same reasoning as
 * `escapeWirefilterString`: a value ending in a backslash would otherwise
 * consume the literal's closing quote instead of terminating the string, and
 * an unescaped quote in a header key or condition value could break out of
 * the string literal and inject arbitrary CEL syntax.
 */
export function escapeCelString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Inverse of `escapeCelString` — decodes `\\` and `\'` escape sequences in
 * the *contents* of a CEL single-quoted string literal (the caller strips
 * the surrounding quotes before calling this). Any other backslash sequence
 * is left as-is; this codebase's CEL string literals only ever use these two.
 */
export function unescapeCelString(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && (value[i + 1] === '\\' || value[i + 1] === "'")) {
      result += value[i + 1]
      i++
    } else {
      result += value[i]
    }
  }
  return result
}
