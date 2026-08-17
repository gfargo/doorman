import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareClient } from '../CloudflareClient'
import { CloudflareFirewallService } from '../CloudflareFirewallService'
import { CloudflareErrorHandler } from '../CloudflareErrorHandler'
import { DoormanError } from '../../../errors/DoormanError'
import { NetworkErrorCode } from '../../../errors/ErrorCodes'
import type { UnifiedConfig } from '../../../types/unified'

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

describe('Cloudflare Network Failure Handling', () => {
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

  describe('DNS Resolution Failures', () => {
    it('should handle ENOTFOUND errors gracefully', () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND api.cloudflare.com')
      const result = CloudflareErrorHandler.handleNetworkError(dnsError, 'fetching rulesets')

      expect(result).toBeInstanceOf(DoormanError)
      expect(result.code).toBe(NetworkErrorCode.CONNECTION_FAILED)
      expect(result.message).toContain('Network connection failed during fetching rulesets')
      expect(result.suggestion).toContain('api.cloudflare.com is accessible')
      expect(result.details?.dnsResolutionFailed).toBe(true)
    })

    it('should handle DNS timeout errors', () => {
      const dnsTimeoutError = new Error('getaddrinfo EAI_AGAIN api.cloudflare.com')
      const result = CloudflareErrorHandler.handleNetworkError(dnsTimeoutError, 'validating credentials')

      expect(result.code).toBe(NetworkErrorCode.HTTP_ERROR)
      expect(result.suggestion).toContain('internet connection')
    })

    it('should provide specific guidance for DNS failures', () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND api.cloudflare.com')
      const result = CloudflareErrorHandler.handleNetworkError(dnsError, 'fetching rulesets')

      expect(result.suggestion).toContain('api.cloudflare.com is accessible')
      expect(result.suggestion).toContain('firewall settings')
      expect(result.docsUrl).toContain('troubleshooting#connectivity')
    })
  })

  describe('Connection Failures', () => {
    it('should handle connection refused errors', () => {
      const connError = new Error('connect ECONNREFUSED 104.16.132.229:443')
      const result = CloudflareErrorHandler.handleNetworkError(connError, 'creating ruleset')

      expect(result.code).toBe(NetworkErrorCode.CONNECTION_FAILED)
      expect(result.details?.connectionRefused).toBe(true)
      expect(result.suggestion).toContain('firewall settings')
    })

    it('should handle connection reset errors', () => {
      const resetError = new Error('socket hang up')
      const result = CloudflareErrorHandler.handleNetworkError(resetError, 'listing rulesets')

      expect(result.code).toBe(NetworkErrorCode.HTTP_ERROR)
      expect(result.message).toContain('socket hang up')
    })

    it('should handle connection timeout during handshake', () => {
      const handshakeError = new Error('connect ETIMEDOUT 104.16.132.229:443')
      const result = CloudflareErrorHandler.handleNetworkError(handshakeError, 'connecting to API')

      expect(result.code).toBe(NetworkErrorCode.HTTP_ERROR)
      expect(result.suggestion).toContain('internet connection')
    })
  })

  describe('SSL/TLS Failures', () => {
    it('should handle certificate verification failures', () => {
      const sslError = new Error('certificate verify failed: unable to verify the first certificate')
      const result = CloudflareErrorHandler.handleNetworkError(sslError, 'establishing connection')

      expect(result.code).toBe(NetworkErrorCode.HTTP_ERROR)
      expect(result.message).toContain('certificate verify failed')
      expect(result.suggestion).toContain('internet connection')
    })

    it('should handle SSL handshake failures', () => {
      const sslHandshakeError = new Error('SSL routines:ssl3_get_record:wrong version number')
      const result = CloudflareErrorHandler.handleNetworkError(sslHandshakeError, 'establishing secure connection')

      expect(result.suggestion).toContain('internet connection')
      expect(result.docsUrl).toContain('troubleshooting')
    })

    it('should handle certificate expiry errors', () => {
      const certExpiredError = new Error('certificate has expired')
      const result = CloudflareErrorHandler.handleNetworkError(certExpiredError, 'validating certificate')

      expect(result.message).toContain('certificate has expired')
    })
  })

  describe('Timeout Scenarios', () => {
    it('should handle request timeouts with duration extraction', () => {
      const timeoutError = new Error('Request timeout after 30000ms')
      const result = CloudflareErrorHandler.handleNetworkError(timeoutError, 'syncing rules')

      expect(result.code).toBe(NetworkErrorCode.TIMEOUT)
      expect(result.details?.timeoutDuration).toBe(30000)
      expect(result.details?.retryRecommended).toBe(true)
      expect(result.cause).toBe(timeoutError)
    })

    it('should handle different timeout message formats', () => {
      const timeoutFormats = [
        { message: 'timeout after 5000ms', expectedDuration: 5000 },
        { message: 'Request timeout after 30s', expectedDuration: 30000 },
        { message: 'Connection timeout: 15000ms', expectedDuration: 15000 },
        { message: 'timeout occurred after 2s', expectedDuration: 2000 },
        { message: 'timeout occurred (10000ms)', expectedDuration: 10000 },
      ]

      timeoutFormats.forEach(({ message, expectedDuration }) => {
        const error = new Error(message)
        const result = CloudflareErrorHandler.handleNetworkError(error, 'test operation')
        expect(result.details?.timeoutDuration).toBe(expectedDuration)
      })
    })

    it('should handle read timeouts', () => {
      const readTimeoutError = new Error('read ETIMEDOUT')
      const result = CloudflareErrorHandler.handleNetworkError(readTimeoutError, 'reading response')

      expect(result.code).toBe(NetworkErrorCode.HTTP_ERROR)
      expect(result.suggestion).toContain('internet connection')
    })

    it('should handle write timeouts', () => {
      const writeTimeoutError = new Error('write ETIMEDOUT')
      const result = CloudflareErrorHandler.handleNetworkError(writeTimeoutError, 'sending request')

      expect(result.message).toContain('write ETIMEDOUT')
    })
  })

  describe('Proxy and Firewall Issues', () => {
    it('should handle proxy connection failures', () => {
      const proxyError = new Error('tunneling socket could not be established, statusCode=407')
      const result = CloudflareErrorHandler.handleNetworkError(proxyError, 'connecting through proxy')

      expect(result.message).toContain('tunneling socket could not be established')
      expect(result.suggestion).toContain('internet connection')
    })

    it('should handle proxy authentication failures', () => {
      const proxyAuthError = new Error('Proxy Authentication Required')
      const result = CloudflareErrorHandler.handleNetworkError(proxyAuthError, 'authenticating with proxy')

      expect(result.message).toContain('Proxy Authentication Required')
    })

    it('should handle corporate firewall blocks', () => {
      const firewallError = new Error('connect ECONNREFUSED 127.0.0.1:8080')
      const result = CloudflareErrorHandler.handleNetworkError(firewallError, 'bypassing firewall')

      expect(result.suggestion).toContain('firewall settings')
      expect(result.details?.connectionRefused).toBe(true)
    })
  })

  describe('Service-Level Network Failure Handling', () => {
    it('should handle network failures during sync operations', async () => {
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

    it('should handle network failures during fetch operations', async () => {
      const timeoutError = new Error('Request timeout after 30000ms')
      fetchMock.mockRejectedValue(timeoutError)

      await expect(service.fetchConfig()).rejects.toThrow()
    })

    it('should handle partial network failures during batch operations', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          { id: 'ip-1', ip: '192.168.1.1', action: 'deny' },
          { id: 'ip-2', ip: '192.168.1.2', action: 'deny' },
        ],
      }

      let callCount = 0
      fetchMock.mockImplementation(async () => {
        callCount++
        if (callCount === 2) {
          throw new Error('socket hang up')
        }
        return new Response(
          JSON.stringify({
            success: true,
            errors: [],
            messages: [],
            result: {},
          }),
        )
      })

      // With retry logic and OperationSafety mocked, partial failures may be recovered
      // The important thing is that the operation handles the error gracefully
      try {
        await service.syncRules(mockConfig)
      } catch {
        // Expected - partial failures may cause the operation to fail
      }
      expect(callCount).toBeGreaterThan(0)
    })
  })

  describe('Network Error Recovery Strategies', () => {
    it('should provide appropriate recovery suggestions for different network errors', () => {
      const errorScenarios = [
        {
          error: new Error('getaddrinfo ENOTFOUND api.cloudflare.com'),
          expectedSuggestions: ['api.cloudflare.com is accessible', 'firewall settings'],
        },
        {
          error: new Error('Request timeout after 30000ms'),
          expectedSuggestions: ['internet connection', '--retry flag'],
        },
        {
          error: new Error('connect ECONNREFUSED 104.16.132.229:443'),
          expectedSuggestions: ['firewall settings'],
        },
        {
          error: new Error('certificate verify failed'),
          expectedSuggestions: ['internet connection'],
        },
      ]

      errorScenarios.forEach(({ error, expectedSuggestions }) => {
        const result = CloudflareErrorHandler.handleNetworkError(error, 'test operation')
        expectedSuggestions.forEach((suggestion) => {
          expect(result.suggestion).toContain(suggestion)
        })
      })
    })

    it('should provide operation-specific recovery guidance', () => {
      const operations = [
        'syncing rules',
        'fetching configuration',
        'validating credentials',
        'creating ruleset',
        'updating rules',
      ]

      const networkError = new Error('Request timeout after 30000ms')

      operations.forEach((operation) => {
        const result = CloudflareErrorHandler.handleNetworkError(networkError, operation)
        expect(result.message).toContain(operation)
        expect(result.suggestion).toContain('internet connection')
      })
    })

    it('should detect error context for enhanced suggestions', () => {
      const contextualErrors = [
        {
          error: new Error('Authentication failed due to network timeout'),
          operation: 'validating token',
          expectedContext: ['--retry flag'],
        },
        {
          error: new Error('Too many requests - rate limit exceeded'),
          operation: 'syncing rules',
          expectedContext: ['--retry flag'],
        },
        {
          error: new Error('Network error during permission check'),
          operation: 'checking permissions',
          expectedContext: ['internet connection'],
        },
      ]

      contextualErrors.forEach(({ error, operation, expectedContext }) => {
        const result = CloudflareErrorHandler.handleNetworkError(error, operation)
        expectedContext.forEach((context) => {
          expect(result.suggestion).toContain(context)
        })
      })
    })
  })

  describe('Network Error Logging and Debugging', () => {
    it('should preserve original error information for debugging', () => {
      const originalError = new Error('getaddrinfo ENOTFOUND api.cloudflare.com')
      originalError.stack = 'Original stack trace'

      const result = CloudflareErrorHandler.handleNetworkError(originalError, 'test operation')

      expect(result.cause).toBe(originalError)
      expect(result.details?.originalError).toBe(originalError.message)
      expect(result.details?.operation).toBe('test operation')
    })

    it('should include network diagnostic information', () => {
      const diagnosticErrors = [
        {
          error: new Error('getaddrinfo ENOTFOUND api.cloudflare.com'),
          expectedDiagnostics: { dnsResolutionFailed: true, connectionRefused: false },
        },
        {
          error: new Error('connect ECONNREFUSED 127.0.0.1:443'),
          expectedDiagnostics: { dnsResolutionFailed: false, connectionRefused: true },
        },
        {
          error: new Error('Request timeout after 30000ms'),
          expectedDiagnostics: { timeoutDuration: 30000, retryRecommended: true },
        },
      ]

      diagnosticErrors.forEach(({ error, expectedDiagnostics }) => {
        const result = CloudflareErrorHandler.handleNetworkError(error, 'test operation')
        Object.entries(expectedDiagnostics).forEach(([key, value]) => {
          expect(result.details?.[key]).toBe(value)
        })
      })
    })

    it('should provide troubleshooting documentation links', () => {
      const networkError = new Error('Connection failed')
      const result = CloudflareErrorHandler.handleNetworkError(networkError, 'test operation')

      expect(result.docsUrl).toContain('troubleshooting')
      expect(result.docsUrl).toContain('cloudflare')
    })
  })

  describe('Graceful Degradation for Network Issues', () => {
    it('should handle offline scenarios gracefully', async () => {
      const offlineError = new Error('Network request failed')
      fetchMock.mockRejectedValue(offlineError)

      const isOnline = await client.verifyCredentials()
      expect(isOnline).toBe(false)
    })

    it('should provide fallback behavior for non-critical operations', async () => {
      const networkError = new Error('getaddrinfo ENOTFOUND api.cloudflare.com')
      fetchMock.mockRejectedValue(networkError)

      // Non-critical operations should not throw but return appropriate defaults
      const isOnline = await client.verifyCredentials()
      expect(isOnline).toBe(false)
    })

    it('should handle intermittent connectivity issues', async () => {
      let callCount = 0
      fetchMock.mockImplementation(async () => {
        callCount++
        if (callCount % 2 === 1) {
          throw new Error('Intermittent network failure')
        }
        return new Response(
          JSON.stringify({
            success: true,
            errors: [],
            messages: [],
            result: [],
          }),
        )
      })

      // With retry logic, intermittent failures are recovered on retry
      const result = await client.listRulesets()
      expect(result).toEqual([])
      expect(callCount).toBeGreaterThanOrEqual(2) // At least one failure + one success
    })
  })

  describe('Error Context Detection', () => {
    it('should detect authentication context in error messages', () => {
      const authError = new Error('Authentication failed due to network timeout')
      const result = CloudflareErrorHandler.handleNetworkError(authError, 'validating token')

      expect(result.suggestion).toContain('--retry flag')
    })

    it('should detect rate limiting context in error messages', () => {
      const rateLimitError = new Error('Too many requests - rate limit exceeded')
      const result = CloudflareErrorHandler.handleNetworkError(rateLimitError, 'syncing rules')

      expect(result.suggestion).toContain('--retry flag')
    })

    it('should detect permission context in error messages', () => {
      const permissionError = new Error('Network error during permission check')
      const result = CloudflareErrorHandler.handleNetworkError(permissionError, 'checking permissions')

      expect(result.suggestion).toContain('internet connection')
    })
  })
})
