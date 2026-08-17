const debugMock = jest.fn()
jest.mock('../../../logger', () => ({
  logger: { debug: (...args: unknown[]) => debugMock(...args), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { VercelProvider } from '../VercelProvider'

describe('VercelProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    debugMock.mockClear()
    process.env = { ...originalEnv }
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    delete process.env.VERCEL_TEAM_ID
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('fromConfig', () => {
    it('never logs any fragment of the API token, even under debug (regression test for #101)', () => {
      const secretToken = 'vercel_super_secret_token_12345'

      VercelProvider.fromConfig({
        token: secretToken,
        projectId: 'prj_123',
        teamId: 'team_456',
      })

      const loggedText = debugMock.mock.calls.map((call) => JSON.stringify(call)).join('\n')
      expect(loggedText).not.toContain(secretToken)
      expect(loggedText).not.toContain(secretToken.substring(0, 10))
    })

    it('throws when token is missing', () => {
      expect(() => VercelProvider.fromConfig({ projectId: 'p', teamId: 't' })).toThrow('Vercel API token is required')
    })
  })
})
