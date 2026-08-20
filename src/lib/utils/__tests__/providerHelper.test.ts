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

  // Characterization tests pinning the credential *precedence* chain, which
  // nothing asserted before: CLI flag > config file > environment variable,
  // independently for every credential. These are the subtleties a
  // credential-resolution refactor (#182) would break silently — a wrong
  // precedence still resolves *a* credential, so the suite would stay green
  // while users authenticated as the wrong project/zone. Written against
  // current behaviour first, as a regression baseline.
  describe('credential precedence (flag > config > env)', () => {
    const mockedVercelFromConfig = VercelProvider.fromConfig as jest.MockedFunction<typeof VercelProvider.fromConfig>
    const mockedCloudflareFromConfig = CloudflareProvider.fromConfig as jest.MockedFunction<
      typeof CloudflareProvider.fromConfig
    >

    describe('vercel', () => {
      it('prefers the CLI flag over both config and env for every credential', async () => {
        process.env.VERCEL_TOKEN = 'env-token'
        process.env.VERCEL_PROJECT_ID = 'env-project'
        process.env.VERCEL_TEAM_ID = 'env-team'

        await getProviderInstance({
          provider: 'vercel',
          token: 'flag-token',
          projectId: 'flag-project',
          teamId: 'flag-team',
          config: { projectId: 'config-project', teamId: 'config-team' } as never,
          interactive: false,
        })

        expect(mockedVercelFromConfig).toHaveBeenCalledWith({
          token: 'flag-token',
          projectId: 'flag-project',
          teamId: 'flag-team',
        })
      })

      it('prefers the config file over env for projectId/teamId', async () => {
        process.env.VERCEL_TOKEN = 'env-token'
        process.env.VERCEL_PROJECT_ID = 'env-project'
        process.env.VERCEL_TEAM_ID = 'env-team'

        await getProviderInstance({
          provider: 'vercel',
          config: { projectId: 'config-project', teamId: 'config-team' } as never,
          interactive: false,
        })

        expect(mockedVercelFromConfig).toHaveBeenCalledWith({
          // token has no config-file home on the legacy shape, so it still
          // comes from env — that asymmetry is intentional and pinned here.
          token: 'env-token',
          projectId: 'config-project',
          teamId: 'config-team',
        })
      })

      it('falls back to env when neither flag nor config supplies a value', async () => {
        process.env.VERCEL_TOKEN = 'env-token'
        process.env.VERCEL_PROJECT_ID = 'env-project'
        process.env.VERCEL_TEAM_ID = 'env-team'

        await getProviderInstance({ provider: 'vercel', interactive: false })

        expect(mockedVercelFromConfig).toHaveBeenCalledWith({
          token: 'env-token',
          projectId: 'env-project',
          teamId: 'env-team',
        })
      })

      it('resolves each credential independently rather than all-or-nothing', async () => {
        process.env.VERCEL_TOKEN = 'env-token'
        process.env.VERCEL_TEAM_ID = 'env-team'

        await getProviderInstance({
          provider: 'vercel',
          projectId: 'flag-project',
          interactive: false,
        })

        expect(mockedVercelFromConfig).toHaveBeenCalledWith({
          token: 'env-token',
          projectId: 'flag-project',
          teamId: 'env-team',
        })
      })

      it('reads projectId/teamId from providers.vercel on a unified config', async () => {
        process.env.VERCEL_TOKEN = 'env-token'

        await getProviderInstance({
          provider: 'vercel',
          config: { providers: { vercel: { projectId: 'unified-project', teamId: 'unified-team' } } } as never,
          interactive: false,
        })

        expect(mockedVercelFromConfig).toHaveBeenCalledWith({
          token: 'env-token',
          projectId: 'unified-project',
          teamId: 'unified-team',
        })
      })
    })

    describe('cloudflare', () => {
      it('prefers the CLI flag over env for every credential', async () => {
        process.env.CLOUDFLARE_API_TOKEN = 'env-api-token'
        process.env.CLOUDFLARE_ZONE_ID = 'env-zone'
        process.env.CLOUDFLARE_ACCOUNT_ID = 'env-account'

        await getProviderInstance({
          provider: 'cloudflare',
          apiToken: 'flag-api-token',
          zoneId: 'flag-zone',
          accountId: 'flag-account',
          interactive: false,
        })

        expect(mockedCloudflareFromConfig).toHaveBeenCalledWith({
          apiToken: 'flag-api-token',
          zoneId: 'flag-zone',
          accountId: 'flag-account',
        })
      })

      it('falls back to env for each credential independently', async () => {
        process.env.CLOUDFLARE_API_TOKEN = 'env-api-token'
        process.env.CLOUDFLARE_ZONE_ID = 'env-zone'
        process.env.CLOUDFLARE_ACCOUNT_ID = 'env-account'

        await getProviderInstance({
          provider: 'cloudflare',
          zoneId: 'flag-zone',
          interactive: false,
        })

        expect(mockedCloudflareFromConfig).toHaveBeenCalledWith({
          apiToken: 'env-api-token',
          zoneId: 'flag-zone',
          accountId: 'env-account',
        })
      })

      it('passes accountId through as undefined when nothing supplies it (it is optional)', async () => {
        process.env.CLOUDFLARE_API_TOKEN = 'env-api-token'
        process.env.CLOUDFLARE_ZONE_ID = 'env-zone'

        await getProviderInstance({ provider: 'cloudflare', interactive: false })

        expect(mockedCloudflareFromConfig).toHaveBeenCalledWith({
          apiToken: 'env-api-token',
          zoneId: 'env-zone',
          accountId: undefined,
        })
      })
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
