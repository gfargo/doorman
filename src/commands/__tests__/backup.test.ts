import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { VercelClient } from '../../lib/services/VercelClient'
import { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { logger } from '../../lib/logger'
import { mockCloudflareClientPrototype } from '../../tests/testHelpers/providerMocks'
import { handler } from '../backup'

jest.mock('../../lib/logger', () => ({ logger: require('../../tests/testHelpers/loggerMock').createLoggerMock() }))
jest.mock('../../lib/services/VercelClient')
jest.mock('../../lib/providers/cloudflare/CloudflareClient')

const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

// Shaped like the real Vercel API response (VercelConfig), including the
// fields Vercel returns that aren't part of a Doorman config — id, crs,
// projectKey, ownerId at the top level, and valid/validationErrors on every
// rule — to guard against validating/saving the raw response as-is, which
// would fail schema validation (additionalProperties: false on both
// FirewallConfig and CustomRule).
const vercelRemoteConfig = {
  version: 5,
  id: 'config_1',
  firewallEnabled: true,
  crs: {},
  rules: [
    {
      id: 'rule_block_admin',
      name: 'Block Admin',
      conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/admin' }] }],
      action: { mitigate: { action: 'deny' } },
      active: true,
      valid: true,
      validationErrors: [],
    },
  ],
  // Includes a hypothetical future API-only field on the IP rule too (see
  // #114) — not observed from the real Vercel API yet, but IPBlockingRule
  // has the same additionalProperties: false restriction as CustomRule, so
  // this guards against the same bug class recurring there.
  ips: [
    {
      id: 'ip_1',
      ip: '203.0.113.5',
      hostname: 'example.com',
      notes: 'Known bad actor',
      action: 'deny',
      valid: true,
    },
  ],
  projectKey: 'pk_123',
  ownerId: 'owner_1',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('backup command', () => {
  let tempDir: string
  let backupDir: string
  let configPath: string

  beforeEach(async () => {
    jest.clearAllMocks()
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with "${code}"`)
    }) as any)
    tempDir = await fs.mkdtemp(join(tmpdir(), 'doorman-backup-test-'))
    backupDir = join(tempDir, 'backups')
    // withCredentials always loads a local config file even though the "create
    // backup" handler doesn't read it — an explicit --config path avoids
    // ConfigFinder's cwd auto-discovery (which dynamic-imports the ESM-only
    // `find-up` package and doesn't play well with ts-jest's CJS transform).
    configPath = join(tempDir, '.doorman.json')
    await fs.writeFile(configPath, JSON.stringify({ rules: [], ips: [] }))
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(vercelRemoteConfig) as any
    mockCloudflareClientPrototype(MockedCloudflareClient)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('creates a backup file for the Vercel provider', async () => {
    await handler({
      provider: 'vercel',
      token: 't',
      projectId: 'prj',
      teamId: 'team',
      config: configPath,
      output: backupDir,
      debug: false,
      ci: true,
    } as any)

    const files = await fs.readdir(backupDir)
    expect(files.some((f) => f.startsWith('firewall-backup-') && f.endsWith('.json'))).toBe(true)

    const content = JSON.parse(await fs.readFile(join(backupDir, files[0]!), 'utf8'))
    expect(content.backup.provider).toBe('vercel')
    expect(content.backup.projectId).toBe('prj')
    // Vercel API-only fields must not leak into the saved backup — this is
    // also what makes the sanitized config pass schema validation at all.
    expect(content.id).toBeUndefined()
    expect(content.crs).toBeUndefined()
    expect(content.projectKey).toBeUndefined()
    expect(content.ownerId).toBeUndefined()
    expect(content.version).toBe(5)
    expect(content.firewallEnabled).toBe(true)
    // Per-rule API-only fields must not leak into the saved backup either.
    expect(content.rules).toHaveLength(1)
    expect(content.rules[0].valid).toBeUndefined()
    expect(content.rules[0].validationErrors).toBeUndefined()
    expect(content.rules[0].name).toBe('Block Admin')
    // Per-IP-rule API-only fields must not leak into the saved backup either
    // (regression test for #114) — legitimate fields must still survive.
    expect(content.ips).toHaveLength(1)
    expect(content.ips[0].valid).toBeUndefined()
    expect(content.ips[0].id).toBe('ip_1')
    expect(content.ips[0].ip).toBe('203.0.113.5')
    expect(content.ips[0].hostname).toBe('example.com')
    expect(content.ips[0].notes).toBe('Known bad actor')
    expect(content.ips[0].action).toBe('deny')
  })

  it('creates a backup file for the Cloudflare provider without crashing (regression test for #82)', async () => {
    await handler({
      provider: 'cloudflare',
      apiToken: 'cf-token',
      zoneId: '0123456789abcdef0123456789abcdef',
      config: configPath,
      output: backupDir,
      debug: false,
      ci: true,
    } as any)

    const files = await fs.readdir(backupDir)
    expect(files.some((f) => f.startsWith('firewall-backup-') && f.endsWith('.json'))).toBe(true)

    const content = JSON.parse(await fs.readFile(join(backupDir, files[0]!), 'utf8'))
    expect(content.backup.provider).toBe('cloudflare')
    expect(content.provider).toBe('cloudflare')
  })

  it('lists existing backups without needing credentials', async () => {
    await fs.mkdir(backupDir, { recursive: true })
    await fs.writeFile(join(backupDir, 'firewall-backup-2024-01-01_00-00-00.json'), '{}')

    await handler({ list: true, output: backupDir, debug: false, ci: true } as any)

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Available Backups'))
  })

  it('refuses to create a backup when the fetched remote config is malformed', async () => {
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue({
      version: 5,
      firewallEnabled: true,
      // Missing conditionGroup/action/active — structurally invalid.
      rules: [{ name: 'Corrupt Rule' }],
      ips: [],
      updatedAt: '2024-01-01T00:00:00Z',
    }) as any

    await expect(
      handler({
        provider: 'vercel',
        token: 't',
        projectId: 'prj',
        teamId: 'team',
        config: configPath,
        output: backupDir,
        debug: false,
        ci: true,
      } as any),
    ).rejects.toThrow()

    await expect(fs.readdir(backupDir)).rejects.toThrow()
  })

  it('restores from a backup file without needing credentials', async () => {
    await fs.mkdir(backupDir, { recursive: true })
    const backupPath = join(backupDir, 'firewall-backup-2024-01-01_00-00-00.json')
    await fs.writeFile(backupPath, JSON.stringify({ rules: [], ips: [] }))
    const outputConfigPath = join(tempDir, 'restored.doorman.json')

    await handler({
      restore: backupPath,
      config: outputConfigPath,
      output: backupDir,
      debug: false,
      ci: true,
    } as any)

    const restored = JSON.parse(await fs.readFile(outputConfigPath, 'utf8'))
    expect(restored.rules).toEqual([])
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Restored configuration'))
  })

  it('restores from a real backup file that carries the `backup` metadata field (regression test for #113)', async () => {
    await fs.mkdir(backupDir, { recursive: true })
    const backupPath = join(backupDir, 'firewall-backup-2024-01-01_00-00-00.json')
    // Shaped like a file `doorman backup` actually writes — includes the
    // `backup` metadata wrapper, which isn't part of the live config schema
    // (additionalProperties: false) and previously failed restore validation.
    await fs.writeFile(
      backupPath,
      JSON.stringify({
        version: 5,
        firewallEnabled: true,
        rules: [],
        ips: [],
        backup: {
          createdAt: '2024-01-01T00:00:00Z',
          source: 'remote',
          provider: 'vercel',
          projectId: 'prj',
          teamId: 'team',
          originalVersion: 5,
        },
      }),
    )
    const outputConfigPath = join(tempDir, 'restored.doorman.json')

    await handler({
      restore: backupPath,
      config: outputConfigPath,
      output: backupDir,
      debug: false,
      ci: true,
    } as any)

    const restored = JSON.parse(await fs.readFile(outputConfigPath, 'utf8'))
    expect(restored.rules).toEqual([])
    expect(restored.backup).toBeUndefined()
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Restored configuration'))
  })
})
