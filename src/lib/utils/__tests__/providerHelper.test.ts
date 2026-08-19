jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../ui/prompt', () => ({
  prompt: jest.fn(),
}))

jest.mock('../../ui/promptSecret', () => ({
  promptSecret: jest.fn(),
}))

jest.mock('../../ui/promptForCredentials', () => ({
  promptForCredentials: jest.fn(),
}))

// Mock the providers
jest.mock('../../providers/vercel', () => ({
  VercelProvider: {
    fromConfig: jest.fn().mockReturnValue({ name: 'vercel' }),
  },
}))

jest.mock('../../providers/cloudflare', () => ({
  CloudflareProvider: {
    fromConfig: jest.fn().mockReturnValue({ name: 'cloudflare' }),
  },
}))

jest.mock('../../providers/ProviderDetector', () => ({
  ProviderDetector: {
    detect: jest.fn().mockReturnValue({ provider: null, confidence: 'low', reasons: [] }),
  },
}))

import { getProviderInstance, getProviderDisplayName, verifyProviderCredentials } from '../providerHelper'
import { VercelProvider } from '../../providers/vercel'
import { CloudflareProvider } from '../../providers/cloudflare'
import { ProviderDetector } from '../../providers/ProviderDetector'
import { prompt } from '../../ui/prompt'
import { promptSecret } from '../../ui/promptSecret'
import { promptForCredentials } from '../../ui/promptForCredentials'
import type { IFirewallProvider } from '../../providers/IFirewallProvider'

describe('providerHelper', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    delete process.env.VERCEL_TEAM_ID
    delete process.env.CLOUDFLARE_API_TOKEN
    delete process.env.CLOUDFLARE_ZONE_ID
    delete process.env.CLOUDFLARE_ACCOUNT_ID
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('getProviderInstance', () => {
    it('uses explicit provider when specified', async () => {
      process.env.VERCEL_TOKEN = 'token'
      process.env.VERCEL_PROJECT_ID = 'proj'
      process.env.VERCEL_TEAM_ID = 'team'

      const { provider } = await getProviderInstance({
        provider: 'vercel',
        interactive: false,
      })
      expect(provider.name).toBe('vercel')
      expect(VercelProvider.fromConfig).toHaveBeenCalled()
    })

    it('uses explicit Cloudflare provider', async () => {
      process.env.CLOUDFLARE_API_TOKEN = 'token'
      process.env.CLOUDFLARE_ZONE_ID = 'zone'

      const { provider } = await getProviderInstance({
        provider: 'cloudflare',
        interactive: false,
      })
      expect(provider.name).toBe('cloudflare')
      expect(CloudflareProvider.fromConfig).toHaveBeenCalled()
    })

    it('auto-detects provider from config when not explicit', async () => {
      ;(ProviderDetector.detect as jest.Mock).mockReturnValue({
        provider: 'vercel',
        confidence: 'high',
        reasons: ['Vercel project ID found'],
      })
      process.env.VERCEL_TOKEN = 'token'
      process.env.VERCEL_PROJECT_ID = 'proj'
      process.env.VERCEL_TEAM_ID = 'team'

      const { provider } = await getProviderInstance({ interactive: false })
      expect(provider.name).toBe('vercel')
    })

    it('defaults to vercel when detection fails and non-interactive', async () => {
      ;(ProviderDetector.detect as jest.Mock).mockReturnValue({
        provider: null,
        confidence: 'low',
        reasons: [],
      })
      process.env.VERCEL_TOKEN = 'token'
      process.env.VERCEL_PROJECT_ID = 'proj'
      process.env.VERCEL_TEAM_ID = 'team'

      const { provider } = await getProviderInstance({ interactive: false })
      expect(provider.name).toBe('vercel')
    })

    it('returns the resolved Vercel credentials so callers do not have to re-prompt (regression test for #93)', async () => {
      const { provider, vercelCredentials } = await getProviderInstance({
        provider: 'vercel',
        token: 'my-token',
        projectId: 'my-project',
        teamId: 'my-team',
        interactive: false,
      })
      expect(provider.name).toBe('vercel')
      expect(vercelCredentials).toEqual({
        token: 'my-token',
        projectId: 'my-project',
        teamId: 'my-team',
      })
    })

    it('does not populate vercelCredentials for the Cloudflare provider', async () => {
      const { vercelCredentials } = await getProviderInstance({
        provider: 'cloudflare',
        apiToken: 'cf-token',
        zoneId: 'cf-zone',
        interactive: false,
      })
      expect(vercelCredentials).toBeUndefined()
    })

    it('passes explicit credentials to Vercel provider', async () => {
      await getProviderInstance({
        provider: 'vercel',
        token: 'my-token',
        projectId: 'my-project',
        teamId: 'my-team',
        interactive: false,
      })
      expect(VercelProvider.fromConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'my-token',
          projectId: 'my-project',
          teamId: 'my-team',
        }),
      )
    })

    it('passes explicit credentials to Cloudflare provider', async () => {
      await getProviderInstance({
        provider: 'cloudflare',
        apiToken: 'cf-token',
        zoneId: 'cf-zone',
        accountId: 'cf-account',
        interactive: false,
      })
      expect(CloudflareProvider.fromConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          apiToken: 'cf-token',
          zoneId: 'cf-zone',
          accountId: 'cf-account',
        }),
      )
    })

    it('resolves projectId/teamId from a legacy config file without prompting (regression test)', async () => {
      const legacyConfig = {
        rules: [],
        projectId: 'legacy-project',
        teamId: 'legacy-team',
      }

      const { provider } = await getProviderInstance({
        provider: 'vercel',
        token: 'my-token',
        config: legacyConfig,
        interactive: true,
      })

      expect(provider.name).toBe('vercel')
      expect(VercelProvider.fromConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'my-token',
          projectId: 'legacy-project',
          teamId: 'legacy-team',
        }),
      )
      expect(promptForCredentials).not.toHaveBeenCalled()
    })

    it('resolves projectId/teamId from a unified config file without prompting (regression test)', async () => {
      const unifiedConfig = {
        rules: [],
        providers: {
          vercel: {
            projectId: 'unified-project',
            teamId: 'unified-team',
          },
        },
      }

      const { provider } = await getProviderInstance({
        provider: 'vercel',
        token: 'my-token',
        config: unifiedConfig,
        interactive: true,
      })

      expect(provider.name).toBe('vercel')
      expect(VercelProvider.fromConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'my-token',
          projectId: 'unified-project',
          teamId: 'unified-team',
        }),
      )
      expect(promptForCredentials).not.toHaveBeenCalled()
    })

    it('throws for Vercel when credentials missing and non-interactive', async () => {
      await expect(getProviderInstance({ provider: 'vercel', interactive: false })).rejects.toThrow(
        /credentials missing/,
      )
    })

    it('throws for Cloudflare when credentials missing and non-interactive', async () => {
      await expect(getProviderInstance({ provider: 'cloudflare', interactive: false })).rejects.toThrow(
        /credentials missing/,
      )
    })

    it('prompts for a missing Cloudflare API token via the masked promptSecret, not the plaintext prompt (regression test for #102)', async () => {
      ;(promptSecret as jest.MockedFunction<typeof promptSecret>).mockResolvedValue('typed-cf-token')
      ;(prompt as jest.MockedFunction<typeof prompt>).mockImplementation((message: unknown) => {
        const text = String(message)
        if (text.includes('Zone ID')) return Promise.resolve('typed-zone')
        if (text.includes('Account ID')) return Promise.resolve('')
        throw new Error(`Unexpected prompt: ${text}`)
      })

      await getProviderInstance({ provider: 'cloudflare', interactive: true })

      expect(promptSecret).toHaveBeenCalledWith(expect.stringContaining('Cloudflare API Token'))
      expect(CloudflareProvider.fromConfig).toHaveBeenCalledWith(
        expect.objectContaining({ apiToken: 'typed-cf-token' }),
      )
    })
  })

  describe('getProviderDisplayName', () => {
    it('returns "Vercel Firewall" for vercel', () => {
      expect(getProviderDisplayName('vercel')).toBe('Vercel Firewall')
    })

    it('returns "Cloudflare WAF" for cloudflare', () => {
      expect(getProviderDisplayName('cloudflare')).toBe('Cloudflare WAF')
    })
  })

  describe('verifyProviderCredentials', () => {
    it('returns true when credentials are valid', async () => {
      const mockProvider: IFirewallProvider = {
        name: 'vercel',
        verifyCredentials: jest.fn().mockResolvedValue(true),
      } as unknown as IFirewallProvider

      const result = await verifyProviderCredentials(mockProvider)
      expect(result).toBe(true)
    })

    it('returns false when credentials are invalid', async () => {
      const mockProvider: IFirewallProvider = {
        name: 'vercel',
        verifyCredentials: jest.fn().mockResolvedValue(false),
      } as unknown as IFirewallProvider

      const result = await verifyProviderCredentials(mockProvider)
      expect(result).toBe(false)
    })

    it('returns false when verification throws', async () => {
      const mockProvider: IFirewallProvider = {
        name: 'vercel',
        verifyCredentials: jest.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as IFirewallProvider

      const result = await verifyProviderCredentials(mockProvider)
      expect(result).toBe(false)
    })
  })
})
