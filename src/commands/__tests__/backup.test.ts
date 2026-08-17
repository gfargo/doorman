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

const vercelRemoteConfig = { version: 5, firewallEnabled: true, rules: [], ips: [], updatedAt: '2024-01-01T00:00:00Z' }

describe('backup command', () => {
  let tempDir: string
  let backupDir: string
  let configPath: string

  beforeEach(async () => {
    jest.clearAllMocks()
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
})
