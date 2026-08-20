import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { handler as syncHandler } from '../commands/sync'
import { handler as downloadHandler } from '../commands/download'
import { FirewallConfig } from '../lib/types'
import { mockVercelClientPrototype } from './testHelpers/providerMocks'

// Mock external dependencies. `sync` and `download` are both migrated onto
// the generic IFirewallProvider path, which resolves
// `providers/vercel/VercelClient`.
jest.mock('../lib/providers/vercel/VercelClient')
jest.mock('../lib/ui/prompt')
jest.mock('../lib/ui/promptForCredentials')

describe('Command Integration Tests', () => {
  let tempDir: string
  let configPath: string

  const mockCredentials = {
    token: 'test-token',
    projectId: 'test-project',
    teamId: 'test-team',
  }

  const mockRemoteConfig = {
    version: 5,
    id: 'config-id',
    firewallEnabled: true,
    crs: {},
    rules: [
      {
        id: 'rule_remote_rule',
        name: 'Remote Rule',
        description: 'A rule from remote',
        conditionGroup: [
          {
            conditions: [
              {
                type: 'path' as const,
                op: 'eq' as const,
                value: '/remote',
              },
            ],
          },
        ],
        action: {
          mitigate: {
            action: 'deny' as const,
          },
        },
        active: true,
      },
    ],
    ips: [
      {
        id: 'ip-remote-1',
        ip: '192.168.1.200',
        hostname: 'remote-host',
        action: 'deny' as const,
      },
    ],
    projectKey: 'project-key',
    ownerId: 'owner-id',
    updatedAt: '2024-01-01T12:00:00Z',
  }

  beforeEach(async () => {
    // Create temporary directory for test configs
    tempDir = await fs.mkdtemp(join(tmpdir(), 'doorman-test-'))
    configPath = join(tempDir, 'test-config.json')

    // Mock process.exit to prevent it from killing Jest workers
    jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit called with "${code}"`)
    })

    // Mock the prompt functions
    const { prompt } = await import('../lib/ui/prompt')
    const { promptForCredentials } = await import('../lib/ui/promptForCredentials')

    ;(prompt as jest.MockedFunction<typeof prompt>).mockResolvedValue(true)
    ;(promptForCredentials as jest.MockedFunction<typeof promptForCredentials>).mockResolvedValue(mockCredentials)

    // Mock providers/vercel/VercelClient — used by `sync`, `watch`,
    // `download`, and every other Vercel command via the generic
    // IFirewallProvider path.
    const { VercelClient } = await import('../lib/providers/vercel/VercelClient')
    const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
    mockVercelClientPrototype(MockedVercelClient as any, { config: mockRemoteConfig as any })
    MockedVercelClient.prototype.createFirewallRule = jest
      .fn()
      .mockImplementation((rule: any) =>
        Promise.resolve({ ...rule, id: `rule_${rule.name.toLowerCase().replace(/\s+/g, '_')}` }),
      ) as any
    MockedVercelClient.prototype.createIPBlockingRule = jest
      .fn()
      .mockImplementation((rule: any) => Promise.resolve({ ...rule, id: 'ip-new-1' })) as any
  })

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true })
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  describe('Download Command', () => {
    test('should create new config file when none exists', async () => {
      // Given
      const { prompt } = await import('../lib/ui/prompt')
      ;(prompt as jest.MockedFunction<typeof prompt>)
        .mockResolvedValueOnce(true) // Create new config
        .mockResolvedValueOnce(true) // Confirm download

      // When
      await downloadHandler({
        config: configPath,
        dryRun: false,
        debug: false,
      } as any)

      // Then
      const configExists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false)
      expect(configExists).toBe(true)

      const savedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
      expect(savedConfig.version).toBe(5)
      expect(savedConfig.rules).toHaveLength(1)
      expect(savedConfig.rules[0]?.name).toBe('Remote Rule')
      expect(savedConfig.ips).toHaveLength(1)
      expect(savedConfig.ips![0]?.ip).toBe('192.168.1.200')
    })

    test('should overwrite existing config file', async () => {
      // Given
      const existingConfig: FirewallConfig = {
        version: 2,
        projectId: 'old-project',
        teamId: 'old-team',
        rules: [
          {
            id: 'rule_old_rule',
            name: 'Old Rule',
            description: 'An old rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path' as const,
                    op: 'eq' as const,
                    value: '/old',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'deny' as const,
              },
            },
            active: true,
          },
        ],
        ips: [],
      }

      await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2))

      const { prompt } = await import('../lib/ui/prompt')
      ;(prompt as jest.MockedFunction<typeof prompt>).mockResolvedValue(true) // Confirm download

      // When
      await downloadHandler({
        config: configPath,
        dryRun: false,
        debug: false,
      } as any)

      // Then
      const savedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
      expect(savedConfig.version).toBe(5) // Updated version
      expect(savedConfig.projectId).toBe('test-project') // Updated project ID
      expect(savedConfig.rules).toHaveLength(1)
      expect(savedConfig.rules[0]?.name).toBe('Remote Rule') // New rule, not old one
    })

    test('should handle dry run mode', async () => {
      // When
      await downloadHandler({
        config: configPath,
        dryRun: true,
        debug: false,
      } as any)

      // Then
      const configExists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false)
      expect(configExists).toBe(false) // No file should be created in dry run
    })

    test('should handle specific version download', async () => {
      // Given
      const specificVersionConfig = { ...mockRemoteConfig, version: 3 }
      const { VercelClient } = await import('../lib/providers/vercel/VercelClient')
      const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
      // @ts-expect-error - Mock type compatibility
      MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(specificVersionConfig)

      const { prompt } = await import('../lib/ui/prompt')
      ;(prompt as jest.MockedFunction<typeof prompt>)
        .mockResolvedValueOnce(true) // Create new config
        .mockResolvedValueOnce(true) // Confirm download

      // When
      await downloadHandler({
        config: configPath,
        configVersion: 3,
        dryRun: false,
        debug: false,
      } as any)

      // Then
      expect(MockedVercelClient.prototype.fetchFirewallConfig).toHaveBeenCalledWith(3)

      const savedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
      expect(savedConfig.version).toBe(3)
    })
  })

  describe('Sync Command', () => {
    test('should handle no changes scenario', async () => {
      // Given
      const localConfig: FirewallConfig = {
        version: 5, // Same as remote
        projectId: 'test-project',
        teamId: 'test-team',
        rules: mockRemoteConfig.rules,
        ips: mockRemoteConfig.ips,
      }

      await fs.writeFile(configPath, JSON.stringify(localConfig, null, 2))

      // When
      await syncHandler({
        config: configPath,
        debug: false,
      } as any)

      // Then
      const { VercelClient } = await import('../lib/providers/vercel/VercelClient')
      const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

      // Should not call any modification methods
      expect(MockedVercelClient.prototype.createFirewallRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.updateFirewallRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.deleteFirewallRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.createIPBlockingRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.updateIPBlockingRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.deleteIPBlockingRule).not.toHaveBeenCalled()
    })
  })

  describe('Sync-Download Workflow', () => {
    test('should maintain consistency between sync and download', async () => {
      // Given - Start with a local config
      const initialConfig: FirewallConfig = {
        version: 1,
        projectId: 'test-project',
        teamId: 'test-team',
        rules: [
          {
            id: 'rule_initial_rule',
            name: 'Initial Rule',
            description: 'Initial rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path' as const,
                    op: 'eq' as const,
                    value: '/initial',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'deny' as const,
              },
            },
            active: true,
          },
        ],
        ips: [],
      }

      await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2))

      const { prompt } = await import('../lib/ui/prompt')
      ;(prompt as jest.MockedFunction<typeof prompt>).mockResolvedValue(true)

      // Both `sync` and `download` go through the generic IFirewallProvider
      // path now, resolving the same providers/vercel/VercelClient instance.
      const { VercelClient: NewVercelClient } = await import('../lib/providers/vercel/VercelClient')
      const MockedNewVercelClient = NewVercelClient as jest.MockedClass<typeof NewVercelClient>

      // Step 1: Sync the initial config. `sync.ts`'s pre-sync diff, syncRules'
      // internal re-diff, and syncRules' post-sync re-fetch each call
      // fetchFirewallConfig — the first two see an empty remote (so the
      // local rule is a create), the rest see the post-sync state.
      const firstSyncPostConfig = {
        // Post-sync state
        ...mockRemoteConfig,
        version: 6,
        rules: [initialConfig.rules[0]],
        ips: [],
      }
      // @ts-expect-error - Mock type compatibility
      MockedNewVercelClient.prototype.fetchFirewallConfig = jest
        .fn()
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValueOnce({ ...mockRemoteConfig, rules: [], ips: [] })
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValueOnce({ ...mockRemoteConfig, rules: [], ips: [] })
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValue(firstSyncPostConfig)

      await syncHandler({
        config: configPath,
        debug: false,
      } as any)

      // Step 2: Download should get the same config back. No further
      // fetchFirewallConfig override needed — the sticky
      // `mockResolvedValue(firstSyncPostConfig)` fallback set above already
      // covers this call too, and matches the expected post-sync state.
      await downloadHandler({
        config: configPath,
        dryRun: false,
        debug: false,
      } as any)

      // Then - The final config should match what we synced
      const finalConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
      expect(finalConfig.version).toBe(6)
      expect(finalConfig.rules).toHaveLength(1)
      expect(finalConfig.rules[0]?.name).toBe('Initial Rule')
    })
  })
})
