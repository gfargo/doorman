jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { ProviderDetector } from '../ProviderDetector'

describe('ProviderDetector', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
    // Clear provider-related env vars
    delete process.env.DOORMAN_PROVIDER
    delete process.env.CLOUDFLARE_ZONE_ID
    delete process.env.CLOUDFLARE_API_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    delete process.env.VERCEL_TOKEN
    delete process.env.FASTLY_WORKSPACE_ID
    delete process.env.FASTLY_API_TOKEN
    delete process.env.GOOGLE_CLOUD_PROJECT
    delete process.env.GCP_POLICY_NAME
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('detect', () => {
    it('detects explicit provider field in config (vercel)', () => {
      const result = ProviderDetector.detect({ provider: 'vercel' })
      expect(result.provider).toBe('vercel')
      expect(result.confidence).toBe('high')
      expect(result.reasons).toContainEqual(expect.stringContaining('Explicit provider'))
    })

    it('detects explicit provider field in config (cloudflare)', () => {
      const result = ProviderDetector.detect({ provider: 'cloudflare' })
      expect(result.provider).toBe('cloudflare')
      expect(result.confidence).toBe('high')
    })

    it('warns and continues for invalid provider in config', () => {
      const result = ProviderDetector.detect({ provider: 'invalid' })
      // Should not return 'invalid' as provider, falls through to other checks
      expect(result.provider).toBeNull()
    })

    it('detects Cloudflare from providers.cloudflare.zoneId', () => {
      const result = ProviderDetector.detect({
        providers: { cloudflare: { zoneId: 'zone-123' } },
      })
      expect(result.provider).toBe('cloudflare')
      expect(result.confidence).toBe('high')
      // Reason text now comes straight from the credential descriptor's
      // `label` (single source of truth, see #182) rather than a separately
      // hand-typed phrase — hence "Zone ID" rather than "zone ID".
      expect(result.reasons).toContainEqual(expect.stringContaining('Cloudflare Zone ID'))
    })

    it('detects Vercel from providers.vercel.projectId', () => {
      const result = ProviderDetector.detect({
        providers: { vercel: { projectId: 'proj-123' } },
      })
      expect(result.provider).toBe('vercel')
      expect(result.confidence).toBe('high')
      expect(result.reasons).toContainEqual(expect.stringContaining('Vercel Project ID'))
    })

    it('detects Vercel from legacy projectId field', () => {
      const result = ProviderDetector.detect({ projectId: 'proj-123' })
      expect(result.provider).toBe('vercel')
      expect(result.confidence).toBe('high')
      expect(result.reasons).toContainEqual(expect.stringContaining('Legacy Vercel'))
    })

    it('detects from DOORMAN_PROVIDER env var', () => {
      process.env.DOORMAN_PROVIDER = 'cloudflare'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('cloudflare')
      expect(result.confidence).toBe('high')
    })

    it('detects Cloudflare from CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN env vars', () => {
      process.env.CLOUDFLARE_ZONE_ID = 'zone-123'
      process.env.CLOUDFLARE_API_TOKEN = 'token-123'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('cloudflare')
      expect(result.confidence).toBe('medium')
    })

    it('detects Cloudflare from CLOUDFLARE_ZONE_ID alone', () => {
      process.env.CLOUDFLARE_ZONE_ID = 'zone-123'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('cloudflare')
      expect(result.confidence).toBe('medium')
    })

    it('detects Vercel from VERCEL_PROJECT_ID + VERCEL_TOKEN env vars', () => {
      process.env.VERCEL_PROJECT_ID = 'proj-123'
      process.env.VERCEL_TOKEN = 'token-123'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('vercel')
      expect(result.confidence).toBe('medium')
    })

    it('detects Vercel from VERCEL_PROJECT_ID alone', () => {
      process.env.VERCEL_PROJECT_ID = 'proj-123'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('vercel')
      expect(result.confidence).toBe('medium')
    })

    // Fastly-specific detection had no test coverage at all before this —
    // real gap, and the most meaningful regression test for #182's actual
    // point: detect()/detectFromEnvironment() are now generic over
    // CREDENTIAL_DESCRIPTORS rather than hand-coding each provider, so
    // correctly detecting the one provider added *after* this detector was
    // originally written (with zero Fastly-specific code in this file) is
    // real evidence the genericity works, not just that it compiles.
    it('detects Fastly from providers.fastly.workspaceId', () => {
      const result = ProviderDetector.detect({
        providers: { fastly: { workspaceId: 'workspace-123' } },
      })
      expect(result.provider).toBe('fastly')
      expect(result.confidence).toBe('high')
      expect(result.reasons).toContainEqual(expect.stringContaining('Fastly Next-Gen WAF Workspace ID'))
    })

    it('detects Fastly from FASTLY_WORKSPACE_ID env var alone', () => {
      process.env.FASTLY_WORKSPACE_ID = 'workspace-123'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('fastly')
      expect(result.confidence).toBe('medium')
    })

    it('detects Fastly from FASTLY_WORKSPACE_ID + FASTLY_API_TOKEN env vars', () => {
      process.env.FASTLY_WORKSPACE_ID = 'workspace-123'
      process.env.FASTLY_API_TOKEN = 'token-123'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('fastly')
      expect(result.confidence).toBe('medium')
    })

    it('detects GCP from providers.gcp.projectId', () => {
      const result = ProviderDetector.detect({
        providers: { gcp: { projectId: 'my-gcp-project' } },
      })
      expect(result.provider).toBe('gcp')
      expect(result.confidence).toBe('high')
      expect(result.reasons).toContainEqual(expect.stringContaining('GCP Project ID'))
    })

    it('detects GCP from GOOGLE_CLOUD_PROJECT env var alone', () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'my-gcp-project'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('gcp')
      expect(result.confidence).toBe('medium')
    })

    it('detects GCP from GOOGLE_CLOUD_PROJECT + GCP_POLICY_NAME env vars', () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'my-gcp-project'
      process.env.GCP_POLICY_NAME = 'my-policy'
      const result = ProviderDetector.detect()
      expect(result.provider).toBe('gcp')
      expect(result.confidence).toBe('medium')
    })

    it('returns null when no provider can be detected', () => {
      const result = ProviderDetector.detect()
      expect(result.provider).toBeNull()
      expect(result.confidence).toBe('low')
    })

    it('returns null when config is undefined', () => {
      const result = ProviderDetector.detect(undefined)
      expect(result.provider).toBeNull()
    })

    it('prioritizes explicit config provider over env vars', () => {
      process.env.CLOUDFLARE_ZONE_ID = 'zone-123'
      const result = ProviderDetector.detect({ provider: 'vercel' })
      expect(result.provider).toBe('vercel')
    })

    it('prioritizes provider-specific config over legacy config', () => {
      const result = ProviderDetector.detect({
        providers: { cloudflare: { zoneId: 'zone-123' } },
        projectId: 'proj-123',
      })
      expect(result.provider).toBe('cloudflare')
    })
  })

  describe('getProvider', () => {
    it('returns detected provider', () => {
      const provider = ProviderDetector.getProvider({ provider: 'cloudflare' })
      expect(provider).toBe('cloudflare')
    })

    it('returns fallback when detection fails', () => {
      const provider = ProviderDetector.getProvider()
      expect(provider).toBe('vercel') // default fallback
    })

    it('uses custom fallback', () => {
      const provider = ProviderDetector.getProvider(undefined, 'cloudflare')
      expect(provider).toBe('cloudflare')
    })
  })

  describe('detectAll', () => {
    it('returns all detected providers from config', () => {
      const providers = ProviderDetector.detectAll({
        providers: {
          cloudflare: { zoneId: 'zone-123' },
          vercel: { projectId: 'proj-123' },
        },
      })
      expect(providers).toContain('cloudflare')
      expect(providers).toContain('vercel')
    })

    it('returns providers from env vars', () => {
      process.env.CLOUDFLARE_ZONE_ID = 'zone-123'
      process.env.VERCEL_PROJECT_ID = 'proj-123'
      const providers = ProviderDetector.detectAll()
      expect(providers).toContain('cloudflare')
      expect(providers).toContain('vercel')
    })

    it('returns empty array when nothing detected', () => {
      const providers = ProviderDetector.detectAll()
      expect(providers).toEqual([])
    })

    it('deduplicates providers', () => {
      process.env.CLOUDFLARE_ZONE_ID = 'zone-123'
      const providers = ProviderDetector.detectAll({
        provider: 'cloudflare',
        providers: { cloudflare: { zoneId: 'zone-123' } },
      })
      const cloudflareCount = providers.filter((p) => p === 'cloudflare').length
      expect(cloudflareCount).toBe(1)
    })

    it('detects from legacy config and explicit provider', () => {
      const providers = ProviderDetector.detectAll({
        provider: 'cloudflare',
        projectId: 'proj-123',
      })
      expect(providers).toContain('cloudflare')
      expect(providers).toContain('vercel')
    })
  })
})
