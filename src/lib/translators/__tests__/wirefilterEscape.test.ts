import { escapeWirefilterString } from '../wirefilterEscape'

describe('escapeWirefilterString', () => {
  it('returns strings with no special characters unchanged', () => {
    expect(escapeWirefilterString('Authorization')).toBe('Authorization')
  })

  it('escapes double quotes', () => {
    expect(escapeWirefilterString('say "hi"')).toBe('say \\"hi\\"')
  })

  it('escapes backslashes', () => {
    expect(escapeWirefilterString('a\\b')).toBe('a\\\\b')
  })

  it('escapes backslashes before quotes, so a trailing backslash cannot consume a wrapping close-quote', () => {
    // If a caller wraps the result in `"${escaped}"`, an unescaped trailing
    // backslash would combine with the wrapping quote to form `\"`, which a
    // wirefilter parser reads as an escaped quote rather than the string's
    // actual terminator.
    const result = escapeWirefilterString('a\\')
    expect(result).toBe('a\\\\')
    expect(`"${result}"`).toBe('"a\\\\"')
  })

  it('escapes an embedded quote so it cannot break out of a field reference', () => {
    // e.g. building `http.cookie["${escaped}"]` from this key must not let the
    // key close the bracket early and append trailing wirefilter syntax.
    const maliciousKey = 'x"] or (true) or http.cookie["x'
    const result = escapeWirefilterString(maliciousKey)
    const fieldRef = `http.cookie["${result}"]`
    expect(fieldRef).toBe('http.cookie["x\\"] or (true) or http.cookie[\\"x"]')
    expect(fieldRef).not.toMatch(/cookie\["[^"\\]*"\] or/)
  })
})
