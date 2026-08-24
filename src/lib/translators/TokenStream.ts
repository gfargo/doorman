/**
 * Generic token cursor shared by `CelParser` and `WirefilterParser` (#252).
 * Grammar-agnostic — CEL and wirefilter tokenize into different `TokenType`
 * unions with different values, but both consume tokens the same mechanical
 * way (peek/next/expect/atEnd over a position that only ever moves forward,
 * except for `CelParser`'s deliberate one-token field-path backtrack, which
 * is why `pos` stays publicly writable rather than private).
 */

export class ParseError extends Error {}

interface GenericToken<TT extends string> {
  type: TT
  value: string
}

export class TokenStream<TT extends string, Tok extends GenericToken<TT> = GenericToken<TT>> {
  pos = 0
  constructor(private tokens: Tok[]) {}

  peek(): Tok | undefined {
    return this.tokens[this.pos]
  }

  next(): Tok {
    const token = this.tokens[this.pos]
    if (!token) {
      throw new ParseError('Unexpected end of expression')
    }
    this.pos++
    return token
  }

  expect(type: TT): Tok {
    const token = this.next()
    if (token.type !== type) {
      throw new ParseError(`Expected ${type} but got '${token.value}'`)
    }
    return token
  }

  /** True if the next token is of `type` with exactly this `value` — e.g. the keyword/identifier `and`, `has`, `exists`. */
  is(type: TT, value: string): boolean {
    const token = this.peek()
    return !!token && token.type === type && token.value === value
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length
  }
}
