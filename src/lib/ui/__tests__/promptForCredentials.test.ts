const promptMock = jest.fn()
const promptSecretMock = jest.fn()
jest.mock('../prompt', () => ({ prompt: (...args: unknown[]) => promptMock(...args) }))
jest.mock('../promptSecret', () => ({ promptSecret: (...args: unknown[]) => promptSecretMock(...args) }))

import { promptForCredentials } from '../promptForCredentials'

describe('promptForCredentials', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_TEAM_ID
    delete process.env.VERCEL_PROJECT_ID
    promptSecretMock.mockResolvedValue('typed-token')
    promptMock.mockImplementation((message: string) => {
      if (message.includes('Team ID')) return Promise.resolve('typed-team')
      if (message.includes('Project ID')) return Promise.resolve('typed-project')
      throw new Error(`Unexpected prompt: ${message}`)
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('prompts for the token via the masked promptSecret, not the plaintext prompt (regression test for #102)', async () => {
    const result = await promptForCredentials({})

    expect(result).toEqual({ token: 'typed-token', teamId: 'typed-team', projectId: 'typed-project' })
    expect(promptSecretMock).toHaveBeenCalledTimes(1)
    expect(promptSecretMock.mock.calls[0]?.[0]).toContain('Vercel API Auth Token')
    // Team ID / project ID aren't secrets — they still use the plaintext prompt.
    expect(promptMock).toHaveBeenCalledTimes(2)
  })

  it('does not prompt for the token at all when already provided', async () => {
    await promptForCredentials({ token: 'given-token', teamId: 'team', projectId: 'project' })

    expect(promptSecretMock).not.toHaveBeenCalled()
  })
})
