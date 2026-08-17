import { EventEmitter } from 'events'

jest.mock('readline', () => ({
  emitKeypressEvents: jest.fn(),
  createInterface: jest.fn(),
}))

import { classifyKeypress, applyKeypressAction, promptSecret } from '../promptSecret'

describe('classifyKeypress', () => {
  it('classifies a printable character as append', () => {
    expect(classifyKeypress('a', { name: 'a' })).toEqual({ type: 'append', char: 'a' })
  })

  it('classifies ctrl+c as cancel', () => {
    expect(classifyKeypress(undefined, { name: 'c', ctrl: true })).toEqual({ type: 'cancel' })
  })

  it('classifies return as submit', () => {
    expect(classifyKeypress(undefined, { name: 'return' })).toEqual({ type: 'submit' })
  })

  it('classifies enter as submit', () => {
    expect(classifyKeypress(undefined, { name: 'enter' })).toEqual({ type: 'submit' })
  })

  it('classifies backspace as backspace', () => {
    expect(classifyKeypress(undefined, { name: 'backspace' })).toEqual({ type: 'backspace' })
  })

  it('ignores other ctrl combinations', () => {
    expect(classifyKeypress(undefined, { name: 'a', ctrl: true })).toEqual({ type: 'ignore' })
  })

  it('ignores arrow keys and other non-printable sequences', () => {
    expect(classifyKeypress(undefined, { name: 'up' })).toEqual({ type: 'ignore' })
  })
})

describe('applyKeypressAction', () => {
  it('appends a character and requests a mask be added', () => {
    expect(applyKeypressAction('ab', { type: 'append', char: 'c' })).toEqual({
      value: 'abc',
      done: false,
      cancelled: false,
      echo: 'add',
    })
  })

  it('removes the last character on backspace', () => {
    expect(applyKeypressAction('abc', { type: 'backspace' })).toEqual({
      value: 'ab',
      done: false,
      cancelled: false,
      echo: 'remove',
    })
  })

  it('is a no-op backspace on an empty buffer', () => {
    expect(applyKeypressAction('', { type: 'backspace' })).toEqual({
      value: '',
      done: false,
      cancelled: false,
      echo: 'none',
    })
  })

  it('finishes on submit without touching the buffer', () => {
    expect(applyKeypressAction('secret', { type: 'submit' })).toEqual({
      value: 'secret',
      done: true,
      cancelled: false,
      echo: 'none',
    })
  })

  it('finishes as cancelled on cancel', () => {
    expect(applyKeypressAction('partial', { type: 'cancel' })).toEqual({
      value: 'partial',
      done: true,
      cancelled: true,
      echo: 'none',
    })
  })
})

describe('promptSecret', () => {
  let stdin: EventEmitter & {
    isTTY: boolean
    isRaw: boolean
    setRawMode: jest.Mock
    resume: jest.Mock
  }
  let stdoutWrites: string[]
  let originalExit: typeof process.exit
  let exitMock: jest.Mock

  beforeEach(() => {
    stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      isRaw: false,
      setRawMode: jest.fn(),
      resume: jest.fn(),
    })
    jest.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as NodeJS.ReadStream & { fd: 0 })

    stdoutWrites = []
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutWrites.push(String(chunk))
      return true
    })

    originalExit = process.exit
    exitMock = jest.fn()
    process.exit = exitMock as unknown as typeof process.exit
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.exit = originalExit
  })

  const typeAndSubmit = (secret: string) => {
    for (const char of secret) {
      stdin.emit('keypress', char, { name: char })
    }
    stdin.emit('keypress', undefined, { name: 'return' })
  }

  it('resolves with the typed value and never echoes it in plaintext (regression test for #102)', async () => {
    const promise = promptSecret('Token: ')
    typeAndSubmit('super-secret-token')

    const result = await promise

    expect(result).toBe('super-secret-token')
    const allOutput = stdoutWrites.join('')
    expect(allOutput).not.toContain('super-secret-token')
    // One '*' per typed character.
    expect((allOutput.match(/\*/g) ?? []).length).toBe('super-secret-token'.length)
  })

  it('handles backspace by erasing the last masked character', async () => {
    const promise = promptSecret('Token: ')
    stdin.emit('keypress', 'a', { name: 'a' })
    stdin.emit('keypress', 'b', { name: 'b' })
    stdin.emit('keypress', undefined, { name: 'backspace' })
    stdin.emit('keypress', 'c', { name: 'c' })
    stdin.emit('keypress', undefined, { name: 'return' })

    const result = await promise
    expect(result).toBe('ac')
  })

  it('exits the process on ctrl+c without resolving the returned secret', async () => {
    const promise = promptSecret('Token: ')
    stdin.emit('keypress', 'a', { name: 'a' })
    stdin.emit('keypress', undefined, { name: 'c', ctrl: true })

    // process.exit is mocked (doesn't actually exit), so the promise never
    // settles — just assert exit(0) was requested with nothing resolved yet.
    await Promise.resolve()
    expect(exitMock).toHaveBeenCalledWith(0)
    void promise
  })

  it('restores the terminal raw-mode state after finishing', async () => {
    const promise = promptSecret('Token: ')
    typeAndSubmit('x')
    await promise

    expect(stdin.setRawMode).toHaveBeenCalledWith(true)
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false)
  })
})
