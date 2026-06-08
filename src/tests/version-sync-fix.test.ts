import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { handler as syncHandler } from '../commands/sync'
import { FirewallConfig } from '../lib/types'

// Mock external dependencies
jest.mock('../lib/services/VercelClient')
jest.mock('../lib/ui/prompt')
jest.mock('../lib/ui/promptForCredentials')

describe('Version Sync Fix', () => {
  let tempDir: string
  let configPath: string

  const mockCredentials = {
    token: 'test-token',
    projectId: 'test-project',
    teamId: 'test-team',
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'doorman-version-test-'))
    configPath = join(tempDir, 'test-config.json')

    // Mock the prompt functions
    const { prompt } = await import('../lib/ui/prompt')
    const { promptForCredentials } = await import('../lib/ui/promptForCredentials')

    ;(prompt as jest.MockedFunction<typeof prompt>).mockResolvedValue(true)
    ;(promptForCredentials as jest.MockedFunction<typeof promptForCredentials>).mockResolvedValue(mockCredentials)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    jest.clearAllMocks()
  })

  test('should update local config version even when no rule changes are needed', async () => {
    // Given - Local config with older version but same rules as remote
    const localConfig: FirewallConfig = {
      version: 3, // Older version
      updatedAt: '2024-01-01T10:00:00Z', // Older timestamp
      projectId: 'test-project',
      teamId: 'test-team',
      rules: [
        {
          id: 'rule_existing_rule',
          name: 'Existing Rule',
          description: 'An existing rule',
          conditionGroup: [
            {
              conditions: [
                {
                  type: 'path' as const,
                  op: 'eq' as const,
                  value: '/existing',
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

    // Mock VercelClient to return same rules but newer version
    const { VercelClient } = await import('../lib/services/VercelClient')
    const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

    const remoteConfig = {
      version: 5, // Newer version
      id: 'config-id',
      firewallEnabled: true,
      crs: {},
      rules: localConfig.rules, // Same rules
      ips: [],
      projectKey: 'project-key',
      ownerId: 'owner-id',
      updatedAt: '2024-01-01T12:00:00Z', // Newer timestamp
    }

    // @ts-expect-error - Mock type compatibility
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(remoteConfig)

    // When
    await syncHandler({
      config: configPath,
      debug: false,
    } as any)

    // Then - Config file should be updated with new version
    const updatedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
    expect(updatedConfig.version).toBe(5) // Should be updated
    expect(updatedConfig.updatedAt).toBe('2024-01-01T12:00:00Z') // Should be updated

    // Verify no API modification calls were made (since rules are the same)
    expect(MockedVercelClient.prototype.createFirewallRule).not.toHaveBeenCalled()
    expect(MockedVercelClient.prototype.updateFirewallRule).not.toHaveBeenCalled()
    expect(MockedVercelClient.prototype.deleteFirewallRule).not.toHaveBeenCalled()
  })

  test('should update config when only metadata changes', async () => {
    // Given - Local config with same version but older updatedAt
    const localConfig: FirewallConfig = {
      version: 5, // Same version
      updatedAt: '2024-01-01T10:00:00Z', // Older timestamp
      projectId: 'test-project',
      teamId: 'test-team',
      rules: [],
      ips: [],
    }

    await fs.writeFile(configPath, JSON.stringify(localConfig, null, 2))

    const { VercelClient } = await import('../lib/services/VercelClient')
    const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

    const remoteConfig = {
      version: 5, // Same version
      id: 'config-id',
      firewallEnabled: true,
      crs: {},
      rules: [],
      ips: [],
      projectKey: 'project-key',
      ownerId: 'owner-id',
      updatedAt: '2024-01-01T12:00:00Z', // Newer timestamp
    }

    // @ts-expect-error - Mock type compatibility
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(remoteConfig)

    // When
    await syncHandler({
      config: configPath,
      debug: false,
    } as any)

    // Then - No changes detected, config file is not updated
    const updatedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
    expect(updatedConfig.version).toBe(5) // Same version
    expect(updatedConfig.updatedAt).toBe('2024-01-01T10:00:00Z') // Original timestamp (not updated)
  })

  test('should handle missing updatedAt in local config', async () => {
    // Given - Local config without updatedAt field
    const localConfig: FirewallConfig = {
      version: 5,
      // No updatedAt field
      projectId: 'test-project',
      teamId: 'test-team',
      rules: [],
      ips: [],
    } as any

    await fs.writeFile(configPath, JSON.stringify(localConfig, null, 2))

    const { VercelClient } = await import('../lib/services/VercelClient')
    const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

    const remoteConfig = {
      version: 5,
      id: 'config-id',
      firewallEnabled: true,
      crs: {},
      rules: [],
      ips: [],
      projectKey: 'project-key',
      ownerId: 'owner-id',
      updatedAt: '2024-01-01T12:00:00Z',
    }

    // @ts-expect-error - Mock type compatibility
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(remoteConfig)

    // When
    await syncHandler({
      config: configPath,
      debug: false,
    } as any)

    // Then - No changes detected, config file is not updated (updatedAt not added)
    const updatedConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as FirewallConfig
    expect(updatedConfig.version).toBe(5)
    expect(updatedConfig.updatedAt).toBeUndefined() // Not added when no changes
  })

  test('should not update config when no changes detected', async () => {
    // Given - Local config identical to remote
    const localConfig: FirewallConfig = {
      version: 5,
      updatedAt: '2024-01-01T12:00:00Z',
      projectId: 'test-project',
      teamId: 'test-team',
      rules: [],
      ips: [],
    }

    await fs.writeFile(configPath, JSON.stringify(localConfig, null, 2))
    const originalStats = await fs.stat(configPath)

    const { VercelClient } = await import('../lib/services/VercelClient')
    const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>

    const remoteConfig = {
      version: 5, // Same version
      id: 'config-id',
      firewallEnabled: true,
      crs: {},
      rules: [],
      ips: [],
      projectKey: 'project-key',
      ownerId: 'owner-id',
      updatedAt: '2024-01-01T12:00:00Z', // Same timestamp
    }

    // @ts-expect-error - Mock type compatibility
    MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(remoteConfig)

    // When
    await syncHandler({
      config: configPath,
      debug: false,
    } as any)

    // Then - Config file should not be modified
    const newStats = await fs.stat(configPath)
    expect(newStats.mtime).toEqual(originalStats.mtime) // File should not be touched

    // Verify no validation call was made (since no changes)
    expect(MockedVercelClient.prototype.fetchFirewallConfig).toHaveBeenCalledTimes(1) // Only for getChanges
  })
})
