jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { CloudflareProvider } from '../cloudflare/CloudflareProvider'
import { VercelProvider } from '../vercel/VercelProvider'

describe('CloudflareProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CLOUDFLARE_API_TOKEN
    delete process.env.CLOUDFLARE_ZONE_ID
    delete process.env.CLOUDFLARE_ACCOUNT_ID
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('create', () => {
    it('creates provider with explicit credentials', () => {
      const provider = CloudflareProvider.create('token', 'zone-id', 'account-id')
      expect(provider.name).toBe('cloudflare')
    })

    it('creates provider from env vars', () => {
      process.env.CLOUDFLARE_API_TOKEN = 'env-token'
      process.env.CLOUDFLARE_ZONE_ID = 'env-zone'
      const provider = CloudflareProvider.create()
      expect(provider.name).toBe('cloudflare')
    })

    it('throws when API token is missing', () => {
      expect(() => CloudflareProvider.create(undefined, 'zone-id')).toThrow(/API token is required/)
    })

    it('throws when zone ID is missing', () => {
      expect(() => CloudflareProvider.create('token')).toThrow(/Zone ID is required/)
    })
  })

  describe('fromEnv', () => {
    it('creates provider from environment variables', () => {
      process.env.CLOUDFLARE_API_TOKEN = 'token'
      process.env.CLOUDFLARE_ZONE_ID = 'zone'
      const provider = CloudflareProvider.fromEnv()
      expect(provider.name).toBe('cloudflare')
    })

    it('throws when env vars are missing', () => {
      expect(() => CloudflareProvider.fromEnv()).toThrow()
    })
  })

  describe('fromConfig', () => {
    it('creates provider from config object', () => {
      const provider = CloudflareProvider.fromConfig({
        apiToken: 'token',
        zoneId: 'zone',
        accountId: 'account',
      })
      expect(provider.name).toBe('cloudflare')
    })

    it('falls back to env vars for missing config fields', () => {
      process.env.CLOUDFLARE_API_TOKEN = 'env-token'
      process.env.CLOUDFLARE_ZONE_ID = 'env-zone'
      const provider = CloudflareProvider.fromConfig({})
      expect(provider.name).toBe('cloudflare')
    })
  })
})

describe('VercelProvider', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    delete process.env.VERCEL_TEAM_ID
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('fromEnv', () => {
    it('creates provider from environment variables', () => {
      process.env.VERCEL_TOKEN = 'token'
      process.env.VERCEL_PROJECT_ID = 'project'
      process.env.VERCEL_TEAM_ID = 'team'
      const provider = VercelProvider.fromEnv()
      expect(provider.name).toBe('vercel')
    })

    it('throws when VERCEL_TOKEN is missing', () => {
      process.env.VERCEL_PROJECT_ID = 'project'
      process.env.VERCEL_TEAM_ID = 'team'
      expect(() => VercelProvider.fromEnv()).toThrow(/VERCEL_TOKEN/)
    })

    it('throws when VERCEL_PROJECT_ID is missing', () => {
      process.env.VERCEL_TOKEN = 'token'
      process.env.VERCEL_TEAM_ID = 'team'
      expect(() => VercelProvider.fromEnv()).toThrow(/VERCEL_PROJECT_ID/)
    })

    it('creates a provider when VERCEL_TEAM_ID is missing — every Vercel account has a default team (regression test for #207)', () => {
      process.env.VERCEL_TOKEN = 'token'
      process.env.VERCEL_PROJECT_ID = 'project'
      const provider = VercelProvider.fromEnv()
      expect(provider.name).toBe('vercel')
    })
  })

  describe('fromConfig', () => {
    it('creates provider from config object', () => {
      const provider = VercelProvider.fromConfig({
        token: 'token',
        projectId: 'project',
        teamId: 'team',
      })
      expect(provider.name).toBe('vercel')
    })

    it('falls back to env vars for missing config fields', () => {
      process.env.VERCEL_TOKEN = 'env-token'
      process.env.VERCEL_PROJECT_ID = 'env-project'
      process.env.VERCEL_TEAM_ID = 'env-team'
      const provider = VercelProvider.fromConfig({})
      expect(provider.name).toBe('vercel')
    })

    it('throws when token is missing from both config and env', () => {
      expect(() => VercelProvider.fromConfig({})).toThrow(/token/)
    })

    it('creates a provider without a teamId (regression test for #207)', () => {
      const provider = VercelProvider.fromConfig({ token: 'token', projectId: 'project' })
      expect(provider.name).toBe('vercel')
    })
  })

  describe('create', () => {
    it('creates provider with explicit credentials', () => {
      const provider = VercelProvider.create('project', 'team', 'token')
      expect(provider.name).toBe('vercel')
    })
  })
})
