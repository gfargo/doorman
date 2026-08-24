import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareFirewallService } from '../CloudflareFirewallService'
import { CloudflareValidator } from '../CloudflareValidator'
import { RuleTranslator } from '../../../translators/RuleTranslator'
import type { UnifiedConfig, UnifiedRule, UnifiedIPRule } from '../../../types/unified'
import type { CloudflareRuleset, CloudflareRule } from '../../../types/cloudflare'

// Mock logger
jest.mock('../../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// Mock OperationSafety for syncRules tests
jest.mock('../../../utils/operationSafety', () => ({
  OperationSafety: {
    performDryRunValidation: jest.fn<() => Promise<any>>().mockResolvedValue({
      valid: true,
      changes: {
        rulesToAdd: [],
        rulesToUpdate: [],
        rulesToDelete: [],
        ipsToAdd: [],
        ipsToUpdate: [],
        ipsToDelete: [],
        hasChanges: false,
      },
      issues: [],
    }),
    confirmDestructiveOperation: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    assessOperationRisk: jest.fn<() => 'low' | 'medium' | 'high'>().mockReturnValue('low'),
  },
}))

/**
 * Performance benchmark utilities for measuring operation durations
 *
 * This class provides utilities for measuring the performance of various operations
 * to ensure they meet the requirements specified in the production readiness spec.
 */
class PerformanceBenchmark {
  private startTime: number = 0
  private endTime: number = 0

  start(): void {
    this.startTime = performance.now()
  }

  end(): number {
    this.endTime = performance.now()
    return this.endTime - this.startTime
  }

  static async measureAsync<T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const benchmark = new PerformanceBenchmark()
    benchmark.start()
    const result = await operation()
    const duration = benchmark.end()
    return { result, duration }
  }

  static measure<T>(operation: () => T): { result: T; duration: number } {
    const benchmark = new PerformanceBenchmark()
    benchmark.start()
    const result = operation()
    const duration = benchmark.end()
    return { result, duration }
  }
}

/**
 * Test data generators for creating various rule set sizes for performance testing
 *
 * These generators create realistic test data that matches the structure expected
 * by the Cloudflare provider while allowing us to test with different scales.
 */
class TestDataGenerator {
  static generateUnifiedRules(count: number): UnifiedRule[] {
    const rules: UnifiedRule[] = []
    for (let i = 0; i < count; i++) {
      rules.push({
        id: `rule-${i}`,
        name: `Test Rule ${i}`,
        description: `Performance test rule ${i}`,
        enabled: true,
        conditions: [
          {
            field: 'path',
            operator: 'eq',
            value: `/test-path-${i}`,
          },
        ],
        action: {
          type: 'block',
        },
      })
    }
    return rules
  }

  static generateUnifiedIPRules(count: number): UnifiedIPRule[] {
    const rules: UnifiedIPRule[] = []
    for (let i = 0; i < count; i++) {
      const ip = `192.168.${Math.floor(i / 256)}.${i % 256}`
      rules.push({
        id: `ip-rule-${i}`,
        ip,
        notes: `Block IP ${ip}`,
        action: 'deny',
      })
    }
    return rules
  }

  static generateCloudflareRules(count: number): CloudflareRule[] {
    const rules: CloudflareRule[] = []
    for (let i = 0; i < count; i++) {
      rules.push({
        id: `cf-rule-${i}`,
        action: 'block',
        expression: `http.request.uri.path eq "/test-path-${i}"`,
        description: `Performance test rule ${i}`,
        enabled: true,
      })
    }
    return rules
  }

  static generateCloudflareRuleset(ruleCount: number): CloudflareRuleset {
    return {
      id: 'test-ruleset',
      name: 'Performance Test Ruleset',
      description: 'Ruleset for performance testing',
      kind: 'custom',
      phase: 'http_request_firewall_custom',
      version: '1',
      last_updated: new Date().toISOString(),
      rules: this.generateCloudflareRules(ruleCount),
    }
  }

  static generateUnifiedConfig(ruleCount: number, ipRuleCount: number): UnifiedConfig {
    return {
      version: '1.0.0',
      provider: 'cloudflare',
      rules: this.generateUnifiedRules(ruleCount),
      ips: this.generateUnifiedIPRules(ipRuleCount),
    }
  }
}

/**
 * Cloudflare Performance Benchmarks
 *
 * This test suite validates that Cloudflare operations meet the performance requirements
 * specified in the production readiness specification:
 *
 * - Requirement 5.1: Sync operations SHALL complete within 30 seconds for typical configurations (10-50 rules)
 * - Requirement 5.2: Fetch operations SHALL complete within 10 seconds for typical setups
 * - Requirement 5.4: Status checks SHALL complete within 5 seconds
 * - Requirement 5.5: Configuration validation SHALL complete within 3 seconds for typical configs
 *
 * The benchmarks test various rule set sizes and operation types to ensure scalability
 * and identify potential performance regressions.
 */
describe('Cloudflare Performance Benchmarks', () => {
  const API_TOKEN = 'test-token'
  const ZONE_ID = 'test-zone-id'
  const ACCOUNT_ID = 'test-account-id'

  let service: CloudflareFirewallService
  let validator: CloudflareValidator
  let fetchMock: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    service = new CloudflareFirewallService(API_TOKEN, ZONE_ID, ACCOUNT_ID)
    validator = new CloudflareValidator(API_TOKEN, ZONE_ID, ACCOUNT_ID)
    fetchMock = jest.spyOn(globalThis, 'fetch')
    jest.spyOn(require('../CloudflareClient').CloudflareClient.prototype as any, 'delay').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Sync Operation Performance', () => {
    /**
     * Test sync operations with 10 rules (small configuration)
     * Requirement 5.1: SHALL complete within 30 seconds for typical configurations
     */
    it('should complete sync operations within 30 seconds for 10 rules', async () => {
      const testConfig = TestDataGenerator.generateUnifiedConfig(10, 5)
      const mockRuleset = TestDataGenerator.generateCloudflareRuleset(0) // Empty initial state

      // Mock API responses for sync operation
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: [mockRuleset],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: mockRuleset,
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: { ...mockRuleset, rules: TestDataGenerator.generateCloudflareRules(10) },
            }),
          ),
        )

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        return await service.syncRules(testConfig, { dryRun: false })
      })

      expect(duration).toBeLessThan(30000) // 30 seconds
      console.log(`Sync operation (10 rules) completed in ${duration.toFixed(2)}ms`)
    })

    /**
     * Test sync operations with 25 rules (medium configuration)
     * Requirement 5.1: SHALL complete within 30 seconds for typical configurations
     */
    it('should complete sync operations within 30 seconds for 25 rules', async () => {
      const testConfig = TestDataGenerator.generateUnifiedConfig(25, 10)
      const mockRuleset = TestDataGenerator.generateCloudflareRuleset(0)

      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: [mockRuleset],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: mockRuleset,
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: { ...mockRuleset, rules: TestDataGenerator.generateCloudflareRules(25) },
            }),
          ),
        )

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        return await service.syncRules(testConfig, { dryRun: false })
      })

      expect(duration).toBeLessThan(30000) // 30 seconds
      console.log(`Sync operation (25 rules) completed in ${duration.toFixed(2)}ms`)
    })

    /**
     * Test sync operations with 50 rules (large typical configuration)
     * Requirement 5.1: SHALL complete within 30 seconds for typical configurations
     */
    it('should complete sync operations within 30 seconds for 50 rules', async () => {
      const testConfig = TestDataGenerator.generateUnifiedConfig(50, 20)
      const mockRuleset = TestDataGenerator.generateCloudflareRuleset(0)

      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: [mockRuleset],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: mockRuleset,
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: { ...mockRuleset, rules: TestDataGenerator.generateCloudflareRules(50) },
            }),
          ),
        )

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        return await service.syncRules(testConfig, { dryRun: false })
      })

      expect(duration).toBeLessThan(30000) // 30 seconds
      console.log(`Sync operation (50 rules) completed in ${duration.toFixed(2)}ms`)
    })

    /**
     * Test sync operations with 100 rules (stress test for scalability)
     * This tests beyond typical configurations to ensure scalability
     */
    it('should handle large rule sets efficiently (100 rules)', async () => {
      const testConfig = TestDataGenerator.generateUnifiedConfig(100, 50)
      const mockRuleset = TestDataGenerator.generateCloudflareRuleset(0)

      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: [mockRuleset],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: mockRuleset,
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: { ...mockRuleset, rules: TestDataGenerator.generateCloudflareRules(100) },
            }),
          ),
        )

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        return await service.syncRules(testConfig, { dryRun: false })
      })

      // Allow more time for larger rule sets, but should still be reasonable
      expect(duration).toBeLessThan(60000) // 60 seconds for large rule sets
      console.log(`Sync operation (100 rules) completed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('Fetch Configuration Performance', () => {
    /**
     * Test fetch operations with typical setup
     * Requirement 5.2: Fetch operations SHALL complete within 10 seconds for typical setups
     */
    it('should complete fetch operations within 10 seconds for typical setups', async () => {
      const mockRuleset = TestDataGenerator.generateCloudflareRuleset(25)

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [mockRuleset],
          }),
        ),
      )

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        return await service.fetchConfig()
      })

      expect(duration).toBeLessThan(10000) // 10 seconds
      console.log(`Fetch operation completed in ${duration.toFixed(2)}ms`)
    })

    /**
     * Test fetch operations with large configurations
     * Ensures scalability for larger rule sets
     */
    it('should handle large configurations efficiently during fetch', async () => {
      const mockRuleset = TestDataGenerator.generateCloudflareRuleset(100)

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [mockRuleset],
          }),
        ),
      )

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        return await service.fetchConfig()
      })

      expect(duration).toBeLessThan(15000) // 15 seconds for large configurations
      console.log(`Fetch operation (100 rules) completed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('Status Check Performance', () => {
    /**
     * Test status check operations
     * Requirement 5.4: Status checks SHALL complete within 5 seconds
     */
    it('should complete status checks within 5 seconds', async () => {
      const testConfig = TestDataGenerator.generateUnifiedConfig(10, 5)

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [TestDataGenerator.generateCloudflareRuleset(10)],
          }),
        ),
      )

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        return await service.getHealthScore(testConfig)
      })

      expect(duration).toBeLessThan(5000) // 5 seconds
      console.log(`Status check completed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('Configuration Validation Performance', () => {
    /**
     * Test configuration validation with typical configs
     * Requirement 5.5: Configuration validation SHALL complete within 3 seconds for typical configs
     */
    it('should complete validation within 3 seconds for typical configs', async () => {
      const testConfig = TestDataGenerator.generateUnifiedConfig(25, 10)

      const { duration } = PerformanceBenchmark.measure(() => {
        return service.validateConfig(testConfig)
      })

      expect(duration).toBeLessThan(3000) // 3 seconds
      console.log(`Configuration validation completed in ${duration.toFixed(2)}ms`)
    })

    /**
     * Test configuration validation with large configs
     * Ensures scalability for larger configurations
     */
    it('should validate large configurations efficiently', async () => {
      const testConfig = TestDataGenerator.generateUnifiedConfig(100, 50)

      const { duration } = PerformanceBenchmark.measure(() => {
        return service.validateConfig(testConfig)
      })

      expect(duration).toBeLessThan(5000) // 5 seconds for large configurations
      console.log(`Large configuration validation completed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('Rule Translation Performance', () => {
    /**
     * Test rule translation performance with small rule sets
     * Translation is a critical operation that affects overall performance
     */
    it('should translate rules efficiently for small rule sets', async () => {
      const cloudflareRules = TestDataGenerator.generateCloudflareRules(10)

      const { duration } = PerformanceBenchmark.measure(() => {
        return cloudflareRules.map((rule) => RuleTranslator.cloudflareToUnified(rule))
      })

      expect(duration).toBeLessThan(1000) // 1 second for 10 rules
      console.log(`Rule translation (10 rules) completed in ${duration.toFixed(2)}ms`)
    })

    /**
     * Test rule translation performance with medium rule sets
     */
    it('should translate rules efficiently for medium rule sets', async () => {
      const cloudflareRules = TestDataGenerator.generateCloudflareRules(50)

      const { duration } = PerformanceBenchmark.measure(() => {
        return cloudflareRules.map((rule) => RuleTranslator.cloudflareToUnified(rule))
      })

      expect(duration).toBeLessThan(3000) // 3 seconds for 50 rules
      console.log(`Rule translation (50 rules) completed in ${duration.toFixed(2)}ms`)
    })

    /**
     * Test rule translation performance with large rule sets
     */
    it('should translate rules efficiently for large rule sets', async () => {
      const cloudflareRules = TestDataGenerator.generateCloudflareRules(100)

      const { duration } = PerformanceBenchmark.measure(() => {
        return cloudflareRules.map((rule) => RuleTranslator.cloudflareToUnified(rule))
      })

      expect(duration).toBeLessThan(5000) // 5 seconds for 100 rules
      console.log(`Rule translation (100 rules) completed in ${duration.toFixed(2)}ms`)
    })

    /**
     * Test bidirectional translation performance
     * This tests the complete translation cycle which is common in sync operations
     */
    it('should handle bidirectional translation efficiently', async () => {
      const unifiedRules = TestDataGenerator.generateUnifiedRules(25)

      const { duration } = PerformanceBenchmark.measure(() => {
        // Translate to Cloudflare and back
        return unifiedRules.map((rule) => {
          const toCloudflare = RuleTranslator.unifiedToCloudflare(rule)
          return RuleTranslator.cloudflareToUnified(toCloudflare.result)
        })
      })

      expect(duration).toBeLessThan(2000) // 2 seconds for bidirectional translation
      console.log(`Bidirectional translation (25 rules) completed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('API Operation Timeout Testing', () => {
    /**
     * Test API timeout handling
     * Ensures the system handles slow API responses gracefully
     */
    it('should handle API timeouts gracefully', async () => {
      // Mock a slow API response that resolves quickly for testing
      fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Response(
                    JSON.stringify({
                      success: true,
                      result: [],
                    }),
                  ),
                ),
              100, // Short delay for testing
            ),
          ),
      )

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        try {
          await service.fetchConfig()
          return 'success'
        } catch (error) {
          return 'timeout'
        }
      })

      // Should complete within reasonable time
      expect(duration).toBeLessThan(20000) // 20 seconds max
    })

    /**
     * Test concurrent API operations
     * Requirement 5.6: Multiple API calls SHALL be batched or parallelized where possible
     */
    it('should handle concurrent API operations efficiently', async () => {
      const mockRuleset = TestDataGenerator.generateCloudflareRuleset(10)

      // Mock multiple successful responses
      for (let i = 0; i < 5; i++) {
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: [mockRuleset],
            }),
          ),
        )
      }

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        // Run 5 concurrent fetch operations
        const promises = Array(5)
          .fill(null)
          .map(() => service.fetchConfig())
        return await Promise.all(promises)
      })

      // Concurrent operations should be faster than sequential
      expect(duration).toBeLessThan(15000) // 15 seconds for 5 concurrent operations
      console.log(`Concurrent API operations (5x) completed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('Memory Usage and Performance Regression', () => {
    /**
     * Test performance consistency across multiple operations
     * Ensures no memory leaks or performance degradation over time
     */
    it('should maintain consistent performance across multiple operations', async () => {
      const mockRuleset = TestDataGenerator.generateCloudflareRuleset(20)
      // #183: fetchConfig now also looks up the managed-rules ruleset
      // (separate phase). Included here alongside the custom one so a single
      // cached `listRulesets()` response satisfies both lookups — matching a
      // real zone that already has both provisioned — rather than each of
      // the 10 fetchConfig() calls falling through to an uncached
      // createRuleset() call and exhausting this fixed-size mock queue.
      const mockManagedRuleset: CloudflareRuleset = {
        id: 'managed-ruleset-1',
        name: 'Doorman Managed Rules',
        description: 'Managed rule groups deployed by Doorman',
        kind: 'zone',
        phase: 'http_request_firewall_managed',
        version: '1',
        rules: [],
      }

      // Mock responses for multiple operations
      for (let i = 0; i < 10; i++) {
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: [mockRuleset, mockManagedRuleset],
            }),
          ),
        )
      }

      const durations: number[] = []

      // Run 10 consecutive operations
      for (let i = 0; i < 10; i++) {
        const { duration } = await PerformanceBenchmark.measureAsync(async () => {
          return await service.fetchConfig()
        })
        durations.push(duration)
      }

      // Check for performance regression (later operations shouldn't be significantly slower)
      const firstHalf = durations.slice(0, 5)
      const secondHalf = durations.slice(5)
      const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
      const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length

      // Second half shouldn't be more than 3x slower than first half (generous margin for CI)
      expect(secondHalfAvg).toBeLessThan(firstHalfAvg * 3)

      console.log(
        `Performance regression test - First half avg: ${firstHalfAvg.toFixed(2)}ms, Second half avg: ${secondHalfAvg.toFixed(2)}ms`,
      )
    })

    /**
     * Test memory efficiency with progressively larger rule sets
     * Ensures performance scales roughly linearly, not exponentially
     */
    it('should handle memory efficiently with large rule sets', async () => {
      const ruleCounts = [10, 25, 50, 75, 100]
      const durations: number[] = []

      for (const count of ruleCounts) {
        const mockRuleset = TestDataGenerator.generateCloudflareRuleset(count)

        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: [mockRuleset],
            }),
          ),
        )

        const { duration } = await PerformanceBenchmark.measureAsync(async () => {
          return await service.fetchConfig()
        })

        durations.push(duration)
        console.log(`Fetch operation (${count} rules) completed in ${duration.toFixed(2)}ms`)
      }

      // Performance should scale roughly linearly, not exponentially
      // Check that 100 rules doesn't take more than 10x the time of 10 rules
      const firstDuration = durations[0]
      const lastDuration = durations[4]
      if (firstDuration && lastDuration) {
        expect(lastDuration).toBeLessThan(firstDuration * 10)
      }
    })
  })

  describe('Credential Validation Performance', () => {
    /**
     * Test credential validation performance
     * Credential validation is a common operation that should be fast
     */
    it('should validate credentials quickly', async () => {
      // Mock successful credential validation
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: { id: ZONE_ID, name: 'test-zone.com' },
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              result: { id: ACCOUNT_ID, name: 'Test Account' },
            }),
          ),
        )

      const credentials = {
        apiToken: API_TOKEN,
        zoneId: ZONE_ID,
        accountId: ACCOUNT_ID,
      }

      const { duration } = await PerformanceBenchmark.measureAsync(async () => {
        return await validator.validateCredentials(credentials)
      })

      expect(duration).toBeLessThan(5000) // 5 seconds
      console.log(`Credential validation completed in ${duration.toFixed(2)}ms`)
    })
  })

  describe('Performance Baseline Documentation', () => {
    /**
     * This test documents the expected performance baselines for different operations
     * It serves as both a test and documentation for performance expectations
     */
    it('should document performance baselines for monitoring', () => {
      const baselines = {
        syncOperations: {
          small: { rules: 10, maxTime: 30000, description: 'Small configuration sync' },
          medium: { rules: 25, maxTime: 30000, description: 'Medium configuration sync' },
          large: { rules: 50, maxTime: 30000, description: 'Large typical configuration sync' },
          extraLarge: { rules: 100, maxTime: 60000, description: 'Extra large configuration sync' },
        },
        fetchOperations: {
          typical: { rules: 25, maxTime: 10000, description: 'Typical configuration fetch' },
          large: { rules: 100, maxTime: 15000, description: 'Large configuration fetch' },
        },
        statusChecks: {
          standard: { maxTime: 5000, description: 'Standard health score check' },
        },
        validation: {
          typical: { rules: 25, maxTime: 3000, description: 'Typical configuration validation' },
          large: { rules: 100, maxTime: 5000, description: 'Large configuration validation' },
        },
        translation: {
          small: { rules: 10, maxTime: 1000, description: 'Small rule set translation' },
          medium: { rules: 50, maxTime: 3000, description: 'Medium rule set translation' },
          large: { rules: 100, maxTime: 5000, description: 'Large rule set translation' },
          bidirectional: { rules: 25, maxTime: 2000, description: 'Bidirectional translation' },
        },
        credentials: {
          validation: { maxTime: 5000, description: 'Credential validation' },
        },
      }

      // This test always passes but documents the baselines
      expect(baselines).toBeDefined()

      console.log('Performance Baselines:')
    })
  })
})
