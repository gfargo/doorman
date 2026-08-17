import { logger } from '../../lib/logger'
import { handler } from '../setup'

jest.mock('../../lib/logger', () => ({
  logger: { log: jest.fn() },
}))

describe('setup command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prints setup instructions without throwing', async () => {
    await expect(handler({} as any)).resolves.toBeUndefined()
    expect(logger.log).toHaveBeenCalled()
  })

  it('mentions the key setup steps', async () => {
    await handler({} as any)

    const output = (logger.log as unknown as jest.Mock).mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Doorman Setup Guide')
    expect(output).toContain('VERCEL_TOKEN')
    expect(output).toContain('doorman init --interactive')
  })
})
