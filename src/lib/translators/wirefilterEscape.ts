/**
 * Escapes a string for safe interpolation into a double-quoted Cloudflare
 * wirefilter string literal (e.g. a field reference like `http.request.headers["<key>"]`
 * or a condition value like `"<value>"`).
 *
 * Backslashes must be escaped *before* quotes — otherwise a value ending in a
 * backslash (e.g. `x\`) would consume the literal's closing quote instead of
 * terminating the string, and an unescaped quote in a header/cookie condition
 * key can break out of the field reference entirely and inject arbitrary
 * wirefilter syntax (e.g. `or (true) or http.request.headers["x`).
 */
export function escapeWirefilterString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Inverse of `escapeWirefilterString` — decodes `\\` and `\"` escape
 * sequences in the *contents* of a wirefilter double-quoted string literal
 * (the caller strips the surrounding quotes before calling this). Any other
 * backslash sequence is left as-is; wirefilter only defines these two.
 */
export function unescapeWirefilterString(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && (value[i + 1] === '\\' || value[i + 1] === '"')) {
      result += value[i + 1]
      i++
    } else {
      result += value[i]
    }
  }
  return result
}
