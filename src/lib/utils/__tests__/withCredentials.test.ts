jest.mock('../../logger', () => ({ logger: require('../../../tests/testHelpers/loggerMock').createLoggerMock() }))

const promptMock = jest.fn()
jest.mock('../../ui/prompt', () => ({ prompt: (...args: unknown[]) => promptMock(...args) }))

const promptSecretMock = jest.fn()
jest.mock('../../ui/promptSecret', () => ({ promptSecret: (...args: unknown[]) => promptSecretMock(...args) }))

import { withCredentials } from '../withCredentials'

describe('withCredentials', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    delete process.env.VERCEL_TEAM_ID
    // The token prompt is masked (see #102) and goes through promptSecret,
    // not the plaintext prompt — team ID / project ID aren't secrets and
    // still go through prompt.
    promptSecretMock.mockResolvedValue('prompted-token')
    promptMock.mockImplementation((message: string) => {
      if (message.includes('Team ID')) return Promise.resolve('prompted-team')
      if (message.includes('Project ID')) return Promise.resolve('prompted-project')
      throw new Error(`Unexpected prompt: ${message}`)
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('prompts for missing Vercel credentials only once, not twice (regression test for #93)', async () => {
    let receivedToken = ''
    let receivedProjectId = ''
    let receivedTeamId = ''

    await withCredentials(
      {
        provider: 'vercel',
        // No config path and no on-disk config — 'optional' mode returns an
        // empty config without touching ConfigFinder's filesystem walk.
        config: '/nonexistent/.doorman.json',
        optionalConfig: true,
        ci: false,
        errorContext: 'test',
      },
      async (ctx) => {
        receivedToken = ctx.token
        receivedProjectId = ctx.projectId
        receivedTeamId = ctx.teamId
      },
    )

    // One prompt each for token (masked), team ID, and project ID — three
    // total across the two prompt functions, not six.
    expect(promptSecretMock).toHaveBeenCalledTimes(1)
    expect(promptMock).toHaveBeenCalledTimes(2)
    expect(receivedToken).toBe('prompted-token')
    expect(receivedProjectId).toBe('prompted-project')
    expect(receivedTeamId).toBe('prompted-team')
  })
})
