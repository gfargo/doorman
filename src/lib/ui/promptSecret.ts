import { emitKeypressEvents } from 'readline'

export interface KeypressKey {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

export type KeypressAction =
  | { type: 'append'; char: string }
  | { type: 'backspace' }
  | { type: 'submit' }
  | { type: 'cancel' }
  | { type: 'ignore' }

export interface KeypressResult {
  value: string
  done: boolean
  cancelled: boolean
  echo: 'add' | 'remove' | 'none'
}

/**
 * Decide what a keypress should do to a masked-input buffer. Pure and
 * testable in isolation — no terminal I/O.
 */
export function classifyKeypress(char: string | undefined, key: KeypressKey | undefined): KeypressAction {
  if (key?.ctrl && key.name === 'c') {
    return { type: 'cancel' }
  }
  if (key?.name === 'return' || key?.name === 'enter') {
    return { type: 'submit' }
  }
  if (key?.name === 'backspace') {
    return { type: 'backspace' }
  }
  // A printable character: no ctrl/meta modifier, and an actual visible
  // character was produced (excludes lone modifier keys, arrows, etc., which
  // readline reports with an empty or control-code `char`).
  if (char && !key?.ctrl && !key?.meta && char.length === 1 && char >= ' ') {
    return { type: 'append', char }
  }
  return { type: 'ignore' }
}

/**
 * Apply a keypress action to the current buffer. Pure and testable —
 * returns the new buffer plus what the caller should do on screen.
 */
export function applyKeypressAction(value: string, action: KeypressAction): KeypressResult {
  switch (action.type) {
    case 'append':
      return { value: value + action.char, done: false, cancelled: false, echo: 'add' }
    case 'backspace':
      if (value.length === 0) {
        return { value, done: false, cancelled: false, echo: 'none' }
      }
      return { value: value.slice(0, -1), done: false, cancelled: false, echo: 'remove' }
    case 'submit':
      return { value, done: true, cancelled: false, echo: 'none' }
    case 'cancel':
      return { value, done: true, cancelled: true, echo: 'none' }
    case 'ignore':
      return { value, done: false, cancelled: false, echo: 'none' }
  }
}

/**
 * Prompt for a secret value (e.g. an API token) with input masked as `*`
 * instead of echoed in plaintext, so it can't be read off a shared terminal
 * or screen recording. Falls back to a normal (unmasked) line read when
 * stdin isn't a TTY — raw mode requires one, and piped/non-interactive input
 * (e.g. CI) has no screen to shoulder-surf in the first place.
 */
export async function promptSecret(message: string): Promise<string> {
  process.stdout.write(message)

  if (!process.stdin.isTTY) {
    const { createInterface } = await import('readline')
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    return new Promise((resolve) => {
      rl.question('', (answer) => {
        rl.close()
        resolve(answer)
      })
    })
  }

  return new Promise((resolve) => {
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    emitKeypressEvents(stdin)
    stdin.setRawMode(true)
    stdin.resume()

    let value = ''

    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress)
      stdin.setRawMode(wasRaw ?? false)
    }

    const onKeypress = (char: string | undefined, key: KeypressKey | undefined) => {
      const action = classifyKeypress(char, key)
      const result = applyKeypressAction(value, action)
      value = result.value

      if (result.echo === 'add') {
        process.stdout.write('*')
      } else if (result.echo === 'remove') {
        process.stdout.write('\b \b')
      }

      if (result.done) {
        cleanup()
        process.stdout.write('\n')
        if (result.cancelled) {
          process.exit(0)
        }
        resolve(value)
      }
    }

    stdin.on('keypress', onKeypress)
  })
}
