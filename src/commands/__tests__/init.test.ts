import { saveConfig } from '../../lib/utils/config'
import { logger } from '../../lib/logger'
import { prompt } from '../../lib/ui/prompt'
import { BASIC_TEMPLATE_RULES, SECURITY_FOCUSED_TEMPLATE_RULES, handler } from '../init'
import { firewallConfigSchema } from '../../lib/schemas/firewallSchemas'
import { createEmptyConfig } from '../../lib/utils/createEmptyConfig'

jest.mock('fs', () => ({ existsSync: jest.fn().mockReturnValue(false) }))

jest.mock('../../lib/logger', () => ({
  logger: {
    log: jest.fn(),
    start: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('../../lib/utils/config', () => ({
  saveConfig: jest.fn(),
}))

jest.mock('../../lib/ui/prompt', () => ({
  prompt: jest.fn(),
}))

const mockedSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>
const mockedPrompt = prompt as jest.MockedFunction<typeof prompt>

describe('init command handler — --interactive default (regression tests for #221)', () => {
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    jest.clearAllMocks()
    mockedSaveConfig.mockResolvedValue(undefined)
    process.stdin.isTTY = true
  })

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY
  })

  it('does not prompt when a template is given positionally and --interactive is not set', async () => {
    await handler({ template: 'security-focused', config: '.doorman.json', force: false } as any)

    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    const [savedConfig] = mockedSaveConfig.mock.calls[0]!
    expect((savedConfig as any).rules).toEqual(SECURITY_FOCUSED_TEMPLATE_RULES)
  })

  it('runs the interactive wizard when no template is given and --interactive is not set', async () => {
    mockedPrompt
      .mockResolvedValueOnce('prj_123') // project ID
      .mockResolvedValueOnce(false) // "using a team account?"
      .mockResolvedValueOnce(false) // "show token help?" (VERCEL_TOKEN unset in test env)
      .mockResolvedValueOnce('basic') // template select

    await handler({ config: '.doorman.json', force: false } as any)

    expect(mockedPrompt).toHaveBeenCalled()
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    const [savedConfig] = mockedSaveConfig.mock.calls[0]!
    expect((savedConfig as any).rules).toEqual(BASIC_TEMPLATE_RULES)
  })

  it('still runs the wizard when --interactive is explicitly set, even with a template given', async () => {
    mockedPrompt.mockResolvedValueOnce('prj_123').mockResolvedValueOnce(false).mockResolvedValueOnce(false)

    await handler({ template: 'basic', interactive: true, config: '.doorman.json', force: false } as any)

    expect(mockedPrompt).toHaveBeenCalled()
  })

  it('does not prompt when --interactive=false is explicit, even with no template', async () => {
    await handler({ interactive: false, config: '.doorman.json', force: false } as any)

    expect(mockedPrompt).not.toHaveBeenCalled()
    expect(mockedSaveConfig).toHaveBeenCalledTimes(1)
    const [savedConfig] = mockedSaveConfig.mock.calls[0]!
    expect((savedConfig as any).rules).toEqual([])
  })

  it("surfaces a prompt() rejection (e.g. prompt.ts's non-TTY guard, #221) as a clean handled error, not an unhandled crash", async () => {
    // Mirrors exactly what the real prompt() now throws on a non-TTY
    // (src/lib/ui/prompt.ts) — this test's concern is init.ts's existing
    // try/catch -> handleCommandError wiring surfacing that message intact,
    // not re-testing the TTY guard itself (see prompt.test.ts for that).
    mockedPrompt.mockRejectedValueOnce(
      new Error('Cannot prompt for "Enter your Vercel Project ID:" — no interactive terminal available.'),
    )
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with "${code}"`)
    }) as any)

    await expect(handler({ config: '.doorman.json', force: false } as any)).rejects.toThrow(
      'process.exit called with "1"',
    )

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('no interactive terminal available'))
    expect(mockedSaveConfig).not.toHaveBeenCalled()
  })
})

describe('init command templates', () => {
  it('produces a schema-valid config for the basic template', () => {
    const config = { ...createEmptyConfig(), rules: BASIC_TEMPLATE_RULES }
    const result = firewallConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  it('produces a schema-valid config for the security-focused template', () => {
    const config = { ...createEmptyConfig(), rules: SECURITY_FOCUSED_TEMPLATE_RULES }
    const result = firewallConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })
})
