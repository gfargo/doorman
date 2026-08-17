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
