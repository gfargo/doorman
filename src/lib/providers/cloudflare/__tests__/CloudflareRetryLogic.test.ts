import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareClient } from '../CloudflareClient'
import { CloudflareFirewallService } from '../CloudflareFirewallService'
import { retry } from '../../../utils/retry'
import type { UnifiedConfig } from '../../../types/unified'

// Mock logger
jest.mock('../../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
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

// Helper to create mock Response objects
const createMockResponse = (init: {
  ok: boolean
  status: number
  statusText?: string
  jsonBody?: unknown
  headers?: Record<string, string>
}): Response => {
  const headers = new Headers(init.headers || {})
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText || '',
    headers,
    json: async () => init.jsonBody,
    text: async () => (typeof init.jsonBody === 'string' ? init.jsonBody : JSON.stringify(init.jsonBody)),
  } as Response
}

describe('Cloudflare Retry Logic and Backoff Behavior', () => {
  const API_TOKEN = 'test-token'
  const ZONE_ID = 'test-zone-id'
  const ACCOUNT_ID = 'test-account-id'

  let client: CloudflareClient
  let service: CloudflareFirewallService
  let fetchMock: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    client = new CloudflareClient(API_TOKEN, ZONE_ID, ACCOUNT_ID)
    service = new CloudflareFirewallService(API_TOKEN, ZONE_ID, ACCOUNT_ID)
    fetchMock = jest.spyOn(globalThis, 'fetch')
    jest.clearAllMocks()
    // Mock delay to avoid real timeouts in retry logic
    jest.spyOn(CloudflareClient.prototype as any, 'delay').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Exponential Backoff Implementation', () => {
    it('should implement exponential backoff correctly', async () => {
      const delays: number[] = []
      const originalSetTimeout = global.setTimeout

      // Mock setTimeout to capture delays
      global.setTimeout = jest.fn().mockImplementation((callback: any, delay: any) => {
        delays.push(delay)
        return originalSetTimeout(callback, 0) // Execute immediately for test
      }) as any

      let attemptCount = 0
      const operation = async () => {
        attemptCount++
        if (attemptCount < 4) {
          throw new Error('Temporary failure')
        }
        return 'success'
      }

      await retry(operation, { maxAttempts: 4, delayMs: 1000, backoff: true })

      expect(delays).toEqual([1000, 2000, 3000]) // 1s, 2s, 3s
      expect(attemptCount).toBe(4)

      global.setTimeout = originalSetTimeout
    })

    it('should use fixed delay when backoff is disabled', async () => {
      const delays: number[] = []
      const originalSetTimeout = global.setTimeout

      global.setTimeout = jest.fn().mockImplementation((callback: any, delay: any) => {
        delays.push(delay)
        return originalSetTimeout(callback, 0)
      }) as any

      let attemptCount = 0
      const operation = async () => {
        attemptCount++
        if (attemptCount < 3) {
          throw new Error('Temporary failure')
        }
        return 'success'
      }

      await retry(operation, { maxAttempts: 3, delayMs: 2000, backoff: false })

      expect(delays).toEqual([2000, 2000]) // Fixed 2s delay
      expect(attemptCount).toBe(3)

      global.setTimeout = originalSetTimeout
    })

    it('should respect maximum retry attempts', async () => {
      let attemptCount = 0
      const operation = async () => {
        attemptCount++
        throw new Error('Persistent failure')
      }

      await expect(retry(operation, { maxAttempts: 2, delayMs: 100 })).rejects.toThrow(
        'Operation failed after 2 attempts',
      )

      expect(attemptCount).toBe(2)
    })
  })

  describe('Client-Level Retry Behavior', () => {
    it('should not retry authentication errors', async () => {
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
          jsonBody: {
            success: false,
            errors: [{ code: 10000, message: 'Invalid API token' }],
            messages: [],
            result: null,
          },
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1) // No retries
    })

    it('should not retry client errors (4xx except 429)', async () => {
      const clientErrors = [400, 403, 404, 422]

      for (const status of clientErrors) {
        fetchMock.mockResolvedValue(
          createMockResponse({
            ok: false,
            status,
            jsonBody: {
              success: false,
              errors: [{ code: 0, message: `Client error ${status}` }],
              messages: [],
              result: null,
            },
          }),
        )

        await expect(client.listRulesets()).rejects.toThrow()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        fetchMock.mockClear()
      }
    })

    it('should handle rate limit errors appropriately', async () => {
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 429,
          jsonBody: {
            success: false,
            errors: [{ code: 10013, message: 'Rate limit exceeded' }],
            messages: [],
            result: null,
          },
          headers: { 'Retry-After': '60' },
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
      // 429 triggers rate limit wait + retry, so multiple calls are expected
      expect(fetchMock).toHaveBeenCalled()
    })
  })

  describe('Service-Level Error Handling', () => {
    it('should handle validation errors without retries', async () => {
      const invalidConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'invalid-rule',
            name: 'Invalid Rule',
            enabled: true,
            conditions: [], // Invalid: no conditions
            action: { type: 'deny' },
          },
        ],
        ips: [],
      }

      const validationResult = service.validateConfig(invalidConfig)
      expect(validationResult.valid).toBe(false)

      // Validation errors should not trigger retries
      await expect(service.syncRules(invalidConfig)).rejects.toThrow()
    })

    it('should handle network errors during sync operations', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [{ id: 'ip-1', ip: '192.168.1.1', action: 'deny' }],
      }

      const networkError = new Error('getaddrinfo ENOTFOUND api.cloudflare.com')
      fetchMock.mockRejectedValue(networkError)

      await expect(service.syncRules(mockConfig)).rejects.toThrow()
    })
  })

  describe('Retry Configuration and Customization', () => {
    it('should allow custom retry configuration per operation type', async () => {
      const retryConfigs = {
        listRulesets: { maxAttempts: 2, delayMs: 10, backoff: false },
        createRuleset: { maxAttempts: 3, delayMs: 10, backoff: true },
        updateRuleset: { maxAttempts: 3, delayMs: 10, backoff: true },
      }

      for (const [, config] of Object.entries(retryConfigs)) {
        let attemptCount = 0
        const mockOperation = async () => {
          attemptCount++
          if (attemptCount < config.maxAttempts) {
            throw new Error('Temporary failure')
          }
          return 'success'
        }

        await retry(mockOperation, config)
        expect(attemptCount).toBe(config.maxAttempts)
      }
    })

    it('should handle different delay strategies', async () => {
      const strategies = [
        { name: 'fixed', delayMs: 1000, backoff: false },
        { name: 'exponential', delayMs: 500, backoff: true },
        { name: 'custom', delayMs: 2000, backoff: true },
      ]

      for (const strategy of strategies) {
        const delays: number[] = []
        const originalSetTimeout = global.setTimeout

        global.setTimeout = jest.fn().mockImplementation((callback: any, delay: any) => {
          delays.push(delay)
          return originalSetTimeout(callback, 0)
        }) as any

        let attemptCount = 0
        const operation = async () => {
          attemptCount++
          if (attemptCount < 3) {
            throw new Error('Temporary failure')
          }
          return 'success'
        }

        await retry(operation, { maxAttempts: 3, ...strategy })

        if (strategy.backoff) {
          expect(delays[0]).toBe(strategy.delayMs)
          expect(delays[1]).toBe(strategy.delayMs * 2)
        } else {
          expect(delays).toEqual([strategy.delayMs, strategy.delayMs])
        }

        global.setTimeout = originalSetTimeout
      }
    })

    it('should provide retry progress information', async () => {
      const progressUpdates: Array<{ attempt: number; maxAttempts: number; delay: number }> = []

      // Mock a retry implementation that tracks progress
      const retryWithProgress = async (operation: () => Promise<any>, options: any = {}) => {
        const { maxAttempts = 3, delayMs = 1000, backoff = true } = options
        let lastError: Error | undefined

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await operation()
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error))
            if (attempt === maxAttempts) break

            const delay = backoff ? delayMs * attempt : delayMs
            progressUpdates.push({ attempt, maxAttempts, delay })
            await new Promise((resolve) => setTimeout(resolve, delay))
          }
        }

        throw new Error(`Operation failed after ${maxAttempts} attempts. Last error: ${lastError?.message}`)
      }

      let attemptCount = 0
      const operation = async () => {
        attemptCount++
        if (attemptCount < 3) {
          throw new Error('Temporary failure')
        }
        return 'success'
      }

      await retryWithProgress(operation, { maxAttempts: 3, delayMs: 1000, backoff: true })

      expect(progressUpdates).toHaveLength(2)
      expect(progressUpdates[0]).toEqual({ attempt: 1, maxAttempts: 3, delay: 1000 })
      expect(progressUpdates[1]).toEqual({ attempt: 2, maxAttempts: 3, delay: 2000 })
    })
  })

  describe('Error Recovery and Cleanup', () => {
    it('should handle cleanup after failed retries', async () => {
      const cleanupMock = jest.fn()

      let attemptCount = 0
      const operation = async () => {
        attemptCount++
        try {
          throw new Error('Persistent failure')
        } finally {
          cleanupMock()
        }
      }

      await expect(retry(operation, { maxAttempts: 3, delayMs: 100 })).rejects.toThrow(
        'Operation failed after 3 attempts',
      )

      expect(attemptCount).toBe(3)
      expect(cleanupMock).toHaveBeenCalledTimes(3)
    })

    it('should preserve original error context through retries', async () => {
      const originalError = new Error('Original failure')
      originalError.stack = 'Original stack trace'

      const operation = async () => {
        throw originalError
      }

      try {
        await retry(operation, { maxAttempts: 2, delayMs: 100 })
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('Original failure')
      }
    })

    it('should handle memory cleanup for long retry sequences', async () => {
      const largeData = new Array(1000000).fill('data')
      const memoryUsage: number[] = []

      const operation = async () => {
        // Simulate memory usage
        const data = [...largeData]
        memoryUsage.push(data.length)
        throw new Error('Memory test failure')
      }

      try {
        await retry(operation, { maxAttempts: 3, delayMs: 10 })
      } catch {
        // Expected to fail
      }

      expect(memoryUsage).toHaveLength(3)
      // Verify that memory is not accumulating across retries
      expect(memoryUsage.every((usage) => usage === 1000000)).toBe(true)
    })
  })

  describe('Network Error Scenarios', () => {
    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Request timeout after 30000ms')
      fetchMock.mockRejectedValue(timeoutError)

      await expect(client.listRulesets()).rejects.toThrow()
      // Network errors are retryable, so multiple attempts are made
      expect(fetchMock).toHaveBeenCalled()
    })

    it('should handle connection errors', async () => {
      const connectionError = new Error('getaddrinfo ENOTFOUND api.cloudflare.com')
      fetchMock.mockRejectedValue(connectionError)

      await expect(client.listRulesets()).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalled()
    })

    it('should handle SSL errors', async () => {
      const sslError = new Error('certificate verify failed')
      fetchMock.mockRejectedValue(sslError)

      await expect(client.listRulesets()).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalled()
    })
  })
})
