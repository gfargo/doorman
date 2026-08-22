import { prompt } from '../prompt'

const mockConsolaPrompt = jest.fn()

jest.mock('consola', () => ({
  __esModule: true,
  default: {
    prompt: (...args: unknown[]) => mockConsolaPrompt(...args),
  },
}))

describe('prompt wrapper', () => {
  let exitSpy: jest.SpyInstance
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    mockConsolaPrompt.mockReset()
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    // Every behavioral test below exercises what happens once a prompt is
    // actually shown — simulate an attached terminal so the new TTY guard
    // (tested separately below) doesn't short-circuit them.
    process.stdin.isTTY = true
  })

  afterEach(() => {
    exitSpy.mockRestore()
    process.stdin.isTTY = originalIsTTY
  })

  it('throws a clean, actionable error instead of reaching consola when stdin is not a TTY (regression test for #221)', async () => {
    process.stdin.isTTY = false
    await expect(prompt('Rule name:', { type: 'text' })).rejects.toThrow(/no interactive terminal available/)
    expect(mockConsolaPrompt).not.toHaveBeenCalled()
  })

  it('normalizes an empty text prompt to an empty string instead of undefined', async () => {
    mockConsolaPrompt.mockResolvedValue(undefined)
    const result = await prompt('Description (optional):', { type: 'text' })
    expect(result).toBe('')
  })

  it('normalizes an empty text prompt (default type) to an empty string', async () => {
    mockConsolaPrompt.mockResolvedValue(undefined)
    const result = await prompt('Rule name:')
    expect(result).toBe('')
  })

  it('passes through a non-empty text response unchanged', async () => {
    mockConsolaPrompt.mockResolvedValue('Block Admin Access')
    const result = await prompt('Rule name:', { type: 'text' })
    expect(result).toBe('Block Admin Access')
  })

  it('does not coerce undefined for non-text prompt types', async () => {
    mockConsolaPrompt.mockResolvedValue(undefined)
    const result = await prompt('Enable rule?', { type: 'confirm' })
    expect(result).toBeUndefined()
  })

  it('passes through boolean confirm responses unchanged', async () => {
    mockConsolaPrompt.mockResolvedValue(false)
    const result = await prompt('Enable rule?', { type: 'confirm' })
    expect(result).toBe(false)
  })

  it('exits the process when the user cancels the prompt', async () => {
    mockConsolaPrompt.mockResolvedValue(Symbol('clack:cancel'))
    await prompt('Rule name:', { type: 'text' })
    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})
