import { escapeCelString, unescapeCelString } from '../celEscape'

describe('escapeCelString', () => {
  it('returns strings with no special characters unchanged', () => {
    expect(escapeCelString('Authorization')).toBe('Authorization')
  })

  it('escapes single quotes', () => {
    expect(escapeCelString("say 'hi'")).toBe("say \\'hi\\'")
  })

  it('escapes backslashes', () => {
    expect(escapeCelString('a\\b')).toBe('a\\\\b')
  })

  it('escapes backslashes before quotes, so a trailing backslash cannot consume a wrapping close-quote', () => {
    const result = escapeCelString('a\\')
    expect(result).toBe('a\\\\')
    expect(`'${result}'`).toBe("'a\\\\'")
  })

  it('escapes an embedded quote so it cannot break out of a field reference', () => {
    const maliciousKey = "x'] || true || request.headers['x"
    const result = escapeCelString(maliciousKey)
    const fieldRef = `request.headers['${result}']`
    expect(fieldRef).not.toMatch(/headers\['[^'\\]*'\] \|\|/)
  })
})

describe('unescapeCelString', () => {
  it('is the exact inverse of escapeCelString', () => {
    const values = ["it's", 'a\\b', "a\\'b", "''", '\\\\', 'plain']
    for (const value of values) {
      expect(unescapeCelString(escapeCelString(value))).toBe(value)
    }
  })
})
