import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { handler as syncHandler } from '../commands/sync'
import { handler as downloadHandler } from '../commands/download'
import { FirewallConfig } from '../lib/types'

// Mock external dependencies
jest.mock('../lib/services/VercelClient')
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

    // Mock VercelClient
    const { VercelClient } = await import('../lib/services/VercelClient')
    const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

    // @ts-expect-error - Mock type compatibility
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(mockRemoteConfig)
    MockedVercelClient.prototype.createFirewallRule = jest
      .fn()
      .mockImplementation((rule: any) =>
        Promise.resolve({ ...rule, id: `rule_${rule.name.toLowerCase().replace(/\s+/g, '_')}` }),
      ) as any
    MockedVercelClient.prototype.updateFirewallRule = jest
      .fn()
      .mockImplementation((rule: any) => Promise.resolve(rule)) as any
    // @ts-expect-error - Mock type compatibility
    MockedVercelClient.prototype.deleteFirewallRule = jest.fn().mockResolvedValue(undefined)
    MockedVercelClient.prototype.createIPBlockingRule = jest
      .fn()
      .mockImplementation((rule: any) => Promise.resolve({ ...rule, id: 'ip-new-1' })) as any
    MockedVercelClient.prototype.updateIPBlockingRule = jest
      .fn()
      .mockImplementation((rule: any) => Promise.resolve(rule)) as any
    // @ts-expect-error - Mock type compatibility
    MockedVercelClient.prototype.deleteIPBlockingRule = jest.fn().mockResolvedValue(undefined)
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
      const { VercelClient } = await import('../lib/services/VercelClient')
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
    test.skip('should sync local changes to remote', async () => {
      // Given
      const localConfig: FirewallConfig = {
        version: 4, // Older version
        projectId: 'test-project',
        teamId: 'test-team',
        rules: [
          {
            id: 'rule_local_rule',
            name: 'Local Rule',
            description: 'A local rule to sync',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path' as const,
                    op: 'eq' as const,
                    value: '/local',
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
            ip: '10.0.0.1',
            hostname: 'local-host',
            action: 'deny' as const,
          },
        ],
      }

      await fs.writeFile(configPath, JSON.stringify(localConfig, null, 2))

      const { prompt } = await import('../lib/ui/prompt')
      ;(prompt as jest.MockedFunction<typeof prompt>).mockResolvedValue(true) // Confirm sync

      // Mock the post-sync validation
      const { VercelClient } = await import('../lib/services/VercelClient')
      const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

      // First call for getChanges, subsequent calls for validation with retry
      const postSyncConfig = {
        // For validation after sync
        ...mockRemoteConfig,
        version: 6, // New version after sync
        rules: [localConfig.rules[0]], // Should have our local rule
        ips: [{ ...localConfig.ips![0], id: 'ip-new-1' }], // With new ID
      }
      // @ts-expect-error - Mock type compatibility
      MockedVercelClient.prototype.fetchFirewallConfig = jest
        .fn()
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValueOnce(mockRemoteConfig) // For getChanges
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValue(postSyncConfig) // For all validation retry attempts

      // When
      await syncHandler({
        config: configPath,
        debug: false,
      } as any)

      // Then
      expect(MockedVercelClient.prototype.deleteFirewallRule).toHaveBeenCalledWith(mockRemoteConfig.rules[0]!)
      expect(MockedVercelClient.prototype.deleteIPBlockingRule).toHaveBeenCalledWith(mockRemoteConfig.ips[0]!)
      expect(MockedVercelClient.prototype.createFirewallRule).toHaveBeenCalledWith(localConfig.rules[0]!)
      expect(MockedVercelClient.prototype.createIPBlockingRule).toHaveBeenCalledWith(localConfig.ips![0]!)

      // Check that config file was updated with new version
      const updatedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
      expect(updatedConfig.version).toBe(6)
    })

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
      const { VercelClient } = await import('../lib/services/VercelClient')
      const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

      // Should not call any modification methods
      expect(MockedVercelClient.prototype.createFirewallRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.updateFirewallRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.deleteFirewallRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.createIPBlockingRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.updateIPBlockingRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.deleteIPBlockingRule).not.toHaveBeenCalled()
    })

    test.skip('should handle rule ID updates', async () => {
      // Given
      const localConfig: FirewallConfig = {
        version: 4,
        projectId: 'test-project',
        teamId: 'test-team',
        rules: [
          {
            id: 'wrong-id-format', // Wrong ID format
            name: 'Test Rule',
            description: 'A test rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path' as const,
                    op: 'eq' as const,
                    value: '/test',
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

      await fs.writeFile(configPath, JSON.stringify(localConfig, null, 2))

      const { prompt } = await import('../lib/ui/prompt')
      ;(prompt as jest.MockedFunction<typeof prompt>)
        .mockResolvedValueOnce(true) // Confirm sync
        .mockResolvedValueOnce(true) // Confirm ID update

      const { VercelClient } = await import('../lib/services/VercelClient')
      const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

      // Mock empty remote config so our rule gets added
      const postSyncIDConfig = {
        // For validation
        ...mockRemoteConfig,
        version: 6,
        rules: [{ ...localConfig.rules[0], id: 'rule_test_rule' }], // Correct ID
        ips: [],
      }
      // @ts-expect-error - Mock type compatibility
      MockedVercelClient.prototype.fetchFirewallConfig = jest
        .fn()
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValueOnce({ ...mockRemoteConfig, rules: [], ips: [] }) // For getChanges
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValue(postSyncIDConfig) // For all validation retry attempts

      // When
      await syncHandler({
        config: configPath,
        debug: false,
      } as any)

      // Then
      const updatedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
      expect(updatedConfig.rules[0]?.id).toBe('rule_test_rule') // Should be updated
    })

    test.skip('should handle sync cancellation', async () => {
      // Given
      const localConfig: FirewallConfig = {
        version: 4,
        projectId: 'test-project',
        teamId: 'test-team',
        rules: [
          {
            id: 'rule_new_rule',
            name: 'New Rule',
            description: 'A new rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path' as const,
                    op: 'eq' as const,
                    value: '/new',
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

      await fs.writeFile(configPath, JSON.stringify(localConfig, null, 2))

      const { prompt } = await import('../lib/ui/prompt')
      ;(prompt as jest.MockedFunction<typeof prompt>).mockResolvedValue(false) // Cancel sync

      // When
      await syncHandler({
        config: configPath,
        debug: false,
      } as any)

      // Then
      const { VercelClient } = await import('../lib/services/VercelClient')
      const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

      // Should not call any modification methods
      expect(MockedVercelClient.prototype.createFirewallRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.updateFirewallRule).not.toHaveBeenCalled()
      expect(MockedVercelClient.prototype.deleteFirewallRule).not.toHaveBeenCalled()
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

      const { VercelClient } = await import('../lib/services/VercelClient')
      const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

      // Step 1: Sync the initial config
      const firstSyncPostConfig = {
        // Post-sync state
        ...mockRemoteConfig,
        version: 6,
        rules: [initialConfig.rules[0]],
        ips: [],
      }
      // @ts-expect-error - Mock type compatibility
      MockedVercelClient.prototype.fetchFirewallConfig = jest
        .fn()
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValueOnce({ ...mockRemoteConfig, rules: [], ips: [] }) // For getChanges
        // @ts-expect-error - Mock type compatibility
        .mockResolvedValue(firstSyncPostConfig) // For all validation retry attempts

      await syncHandler({
        config: configPath,
        debug: false,
      } as any)

      // Step 2: Download should get the same config back
      const postSyncConfig = {
        ...mockRemoteConfig,
        version: 6,
        rules: [initialConfig.rules[0]],
        ips: [],
      }

      // @ts-expect-error - Mock type compatibility
      MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(postSyncConfig)

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
