import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareErrorHandler } from '../CloudflareErrorHandler'
import { CloudflareClient } from '../CloudflareClient'
import { CloudflareFirewallService } from '../CloudflareFirewallService'
import { DoormanError } from '../../../errors/DoormanError'
import { CloudflareErrorCode, ProviderErrorCode, NetworkErrorCode } from '../../../errors/ErrorCodes'
import type { CloudflareAPIResponse } from '../../../types/cloudflare'
import type { CloudflareApiError } from '../CloudflareErrorHandler'
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

describe('Comprehensive Cloudflare Error Handling Tests', () => {
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
    jest.spyOn(CloudflareClient.prototype as any, 'delay').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Error Message Formatting and Suggestion Accuracy', () => {
    describe('Authentication Errors', () => {
      it('should format 401 errors with specific token guidance', () => {
        const apiError: CloudflareApiError = {
          status: 401,
          code: 10000,
          message: 'Invalid API token',
          endpoint: '/zones/test/rulesets',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result).toBeInstanceOf(DoormanError)
        expect(result.code).toBe(ProviderErrorCode.AUTH_FAILED)
        expect(result.message).toContain('Authentication failed')
        expect(result.suggestion).toContain('CLOUDFLARE_API_TOKEN')
        expect(result.suggestion).toContain('valid and not expired')
        expect(result.docsUrl).toContain('setup#api-token')
        expect(result.details?.hint).toContain('dash.cloudflare.com/profile/api-tokens')
      })

      it('should format expired token errors with renewal guidance', () => {
        const apiError: CloudflareApiError = {
          status: 401,
          code: 10000,
          message: 'Token has expired',
          endpoint: '/zones/test/rulesets',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.code).toBe(ProviderErrorCode.AUTH_FAILED)
        expect(result.suggestion).toContain('Create a new token if needed')
      })
    })

    describe('Permission Errors', () => {
      it('should format zone permission errors with specific guidance', () => {
        const apiError: CloudflareApiError = {
          status: 403,
          code: 10001,
          message: 'Insufficient permissions for zone',
          endpoint: '/zones/invalid-zone/rulesets',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.code).toBe(CloudflareErrorCode.ZONE_ID_REQUIRED)
        expect(result.message).toContain('Invalid zone ID')
        expect(result.suggestion).toContain('Zone:Edit permissions')
        expect(result.suggestion).toContain('zone ID is correct')
        expect(result.docsUrl).toContain('setup#permissions')
      })

      it('should format account permission errors with Lists API context', () => {
        const apiError: CloudflareApiError = {
          status: 403,
          code: 10001,
          message: 'Access denied',
          endpoint: '/accounts/invalid-account/rules/lists',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.code).toBe(CloudflareErrorCode.ACCOUNT_ID_REQUIRED)
        expect(result.message).toContain('Invalid account ID')
        expect(result.suggestion).toContain('Account:Read permissions')
        expect(result.suggestion).toContain('account ID is correct')
      })
    })

    describe('Rate Limiting Errors', () => {
      it('should format rate limit errors with retry timing and suggestions', () => {
        const apiError: CloudflareApiError = {
          status: 429,
          code: 10013,
          message: 'Rate limit exceeded',
          endpoint: '/zones/test/rulesets',
          details: { retryAfter: 120 },
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.code).toBe(ProviderErrorCode.RATE_LIMIT)
        expect(result.message).toContain('Rate limit exceeded')
        expect(result.suggestion).toContain('120 seconds')
        expect(result.suggestion).toContain('--retry flag')
        expect(result.suggestion).toContain('exponential backoff')
        expect(result.details?.hint).toContain('upgrading your Cloudflare plan')
      })

      it('should handle rate limit errors without retry-after header', () => {
        const apiError: CloudflareApiError = {
          status: 429,
          code: 10013,
          message: 'Too many requests',
          endpoint: '/zones/test/rulesets',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.suggestion).toContain('60 seconds') // Default fallback
      })
    })

    describe('Validation Errors', () => {
      it('should format rule validation errors with specific field guidance', () => {
        const result = CloudflareErrorHandler.handleValidationError('rules', 'missing required field: action', {
          field: 'action',
          ruleId: 'test-rule',
        })

        expect(result.code).toBe(CloudflareErrorCode.INVALID_RULESET)
        expect(result.message).toContain('Configuration validation failed for rules')
        expect(result.message).toContain('missing required field: action')
        expect(result.suggestion).toContain('rule configuration syntax')
        expect(result.suggestion).toContain('required fields are present')
        expect(result.details?.field).toBe('rules')
        expect(result.details?.value).toEqual({ field: 'action', ruleId: 'test-rule' })
      })

      it('should format expression validation errors with Wirefilter guidance', () => {
        const result = CloudflareErrorHandler.handleValidationError(
          'expression',
          'invalid operator "contains"',
          'ip.src contains "192.168"',
        )

        expect(result.code).toBe(CloudflareErrorCode.INVALID_EXPRESSION)
        expect(result.suggestion).toContain('Cloudflare Wirefilter expression syntax')
        expect(result.suggestion).toContain('field names and operators')
        expect(result.docsUrl).toContain('expressions')
      })

      it('should format IP validation errors with format examples', () => {
        const result = CloudflareErrorHandler.handleValidationError('ip', 'invalid format', '999.999.999.999')

        expect(result.code).toBe(CloudflareErrorCode.INVALID_IP)
        expect(result.suggestion).toContain('IPv4 or IPv6 address')
        expect(result.suggestion).toContain('CIDR notation')
        expect(result.suggestion).toContain('192.168.1.1')
        expect(result.suggestion).toContain('192.168.1.0/24')
      })
    })

    describe('Server and API Errors', () => {
      it('should format server errors with status page reference', () => {
        const apiError: CloudflareApiError = {
          status: 500,
          code: 0,
          message: 'Internal server error',
          endpoint: '/zones/test/rulesets',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.code).toBe(ProviderErrorCode.API_ERROR)
        expect(result.message).toContain('Cloudflare server error (500)')
        expect(result.suggestion).toContain('temporary Cloudflare issue')
        expect(result.suggestion).toContain('status page')
        expect(result.details?.statusPage).toBe('https://www.cloudflarestatus.com/')
      })

      it('should format maintenance mode errors with appropriate guidance', () => {
        const apiError: CloudflareApiError = {
          status: 503,
          code: 1020,
          message: 'Service temporarily unavailable',
          endpoint: '/zones/test/rulesets',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.code).toBe(CloudflareErrorCode.MAINTENANCE_MODE)
        expect(result.message).toContain('maintenance mode')
        expect(result.suggestion).toContain('Wait for maintenance to complete')
        expect(result.details?.statusPage).toBe('https://www.cloudflarestatus.com/')
      })
    })

    describe('Cloudflare-Specific Error Codes', () => {
      it('should format rule limit exceeded errors with consolidation suggestions', () => {
        const apiError: CloudflareApiError = {
          status: 400,
          code: 81045,
          message: 'Rule limit exceeded',
          endpoint: '/zones/test/rulesets',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.code).toBe(CloudflareErrorCode.RULE_LIMIT_EXCEEDED)
        expect(result.suggestion).toContain('consolidating rules')
        expect(result.suggestion).toContain('Lists for IP blocking')
        expect(result.suggestion).toContain('upgrading your Cloudflare plan')
      })

      it('should format zone suspended errors with support guidance', () => {
        const apiError: CloudflareApiError = {
          status: 403,
          code: 1001,
          message: 'Zone suspended',
          endpoint: '/zones/test/rulesets',
        }

        const result = CloudflareErrorHandler.handleApiError(apiError)

        expect(result.code).toBe(CloudflareErrorCode.ZONE_SUSPENDED)
        expect(result.message).toContain('Zone is suspended')
        expect(result.suggestion).toContain('Contact Cloudflare support')
      })
    })
  })

  describe('Network Error Handling', () => {
    describe('Timeout Errors', () => {
      it('should handle request timeout errors with retry suggestions', () => {
        const timeoutError = new Error('Request timeout after 30000ms')
        const result = CloudflareErrorHandler.handleNetworkError(timeoutError, 'syncing rules')

        expect(result.code).toBe(NetworkErrorCode.TIMEOUT)
        expect(result.message).toContain('Request timeout during syncing rules')
        expect(result.suggestion).toContain('internet connection')
        expect(result.suggestion).toContain('--retry flag')
        expect(result.details?.timeoutDuration).toBe(30000)
        expect(result.details?.retryRecommended).toBe(true)
        expect(result.cause).toBe(timeoutError)
      })

      it('should extract timeout duration from various error message formats', () => {
        const testCases = [
          { message: 'timeout after 5000ms', expected: 5000 },
          { message: 'Request timeout after 30s', expected: 30000 },
          { message: 'Connection timeout: 15000ms', expected: 15000 },
          { message: 'timeout occurred after 2s', expected: 2000 },
        ]

        testCases.forEach(({ message, expected }) => {
          const error = new Error(message)
          const result = CloudflareErrorHandler.handleNetworkError(error, 'test operation')
          expect(result.details?.timeoutDuration).toBe(expected)
        })
      })
    })

    describe('Connection Errors', () => {
      it('should handle DNS resolution failures with specific guidance', () => {
        const dnsError = new Error('getaddrinfo ENOTFOUND api.cloudflare.com')
        const result = CloudflareErrorHandler.handleNetworkError(dnsError, 'fetching rulesets')

        expect(result.code).toBe(NetworkErrorCode.CONNECTION_FAILED)
        expect(result.message).toContain('Network connection failed during fetching rulesets')
        expect(result.suggestion).toContain('api.cloudflare.com is accessible')
        expect(result.details?.dnsResolutionFailed).toBe(true)
        expect(result.details?.connectionRefused).toBe(false)
      })

      it('should handle connection refused errors with firewall guidance', () => {
        const connError = new Error('connect ECONNREFUSED 127.0.0.1:443')
        const result = CloudflareErrorHandler.handleNetworkError(connError, 'validating credentials')

        expect(result.code).toBe(NetworkErrorCode.CONNECTION_FAILED)
        expect(result.message).toContain('Network connection failed during validating credentials')
        expect(result.suggestion).toContain('firewall settings')
        expect(result.details?.connectionRefused).toBe(true)
        expect(result.details?.dnsResolutionFailed).toBe(false)
      })

      it('should handle SSL/TLS certificate errors', () => {
        const sslError = new Error('certificate verify failed: unable to verify the first certificate')
        const result = CloudflareErrorHandler.handleNetworkError(sslError, 'connecting to API')

        expect(result.code).toBe(NetworkErrorCode.HTTP_ERROR)
        expect(result.message).toContain('certificate verify failed')
        expect(result.suggestion).toContain('internet connection')
      })
    })
  })

  describe('Basic Retry Behavior Validation', () => {
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
      expect(fetchMock).toHaveBeenCalledTimes(1) // No retries for auth errors
    })

    it('should handle server errors appropriately', async () => {
      fetchMock.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          jsonBody: {
            success: false,
            errors: [{ code: 0, message: 'Internal server error' }],
            messages: [],
            result: null,
          },
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow(DoormanError)
    })
  })

  describe('Graceful Error Handling', () => {
    describe('Malformed Response Handling', () => {
      it('should handle malformed JSON responses gracefully', async () => {
        fetchMock.mockResolvedValue(
          createMockResponse({
            ok: true,
            status: 200,
            jsonBody: 'invalid json{',
          }),
        )

        await expect(client.listRulesets()).rejects.toThrow(DoormanError)
      })

      it('should handle missing required fields in API responses', async () => {
        fetchMock.mockResolvedValue(
          createMockResponse({
            ok: true,
            status: 200,
            jsonBody: { success: true }, // Missing errors, messages, result
          }),
        )

        // When success is true but result is missing, listRulesets returns empty array
        const result = await client.listRulesets()
        expect(result).toEqual([])
      })

      it('should handle null/undefined error messages in API responses', async () => {
        const response: CloudflareAPIResponse<any> = {
          success: false,
          errors: [
            { code: 10000, message: null as any },
            { code: 10001, message: undefined as any },
          ],
          messages: [],
          result: null,
        }

        const result = CloudflareErrorHandler.handleApiResponse(response, '/test/endpoint')
        expect(result).toBeInstanceOf(DoormanError)
        expect(result.message).toBeDefined()
      })
    })

    describe('Edge Case Error Scenarios', () => {
      it('should handle empty error arrays in API responses', async () => {
        const response: CloudflareAPIResponse<any> = {
          success: false,
          errors: [],
          messages: [],
          result: null,
        }

        const result = CloudflareErrorHandler.handleApiResponse(response, '/test/endpoint')
        expect(result).toBeInstanceOf(DoormanError)
        expect(result.code).toBe(ProviderErrorCode.API_ERROR)
      })

      it('should handle multiple error codes in single response', async () => {
        const response: CloudflareAPIResponse<any> = {
          success: false,
          errors: [
            { code: 10000, message: 'Authentication failed' },
            { code: 10001, message: 'Insufficient permissions' },
            { code: 81044, message: 'Ruleset not found' },
          ],
          messages: [],
          result: null,
        }

        const result = CloudflareErrorHandler.handleApiResponse(response, '/test/endpoint')
        expect(result).toBeInstanceOf(DoormanError)
        expect(result.message).toContain('Authentication failed')
        // The first error code (10000) maps to authentication error
        expect(result.details).toBeDefined()
      })
    })

    describe('Graceful Degradation Scenarios', () => {
      it('should handle Lists API unavailable with clear fallback messaging', () => {
        const result = CloudflareErrorHandler.handleGracefulDegradation(
          'lists_api',
          'Account ID not provided',
          'Using individual IP rules instead',
          'May be slower for large IP lists',
        )

        expect(result.code).toBe(CloudflareErrorCode.ACCOUNT_ID_REQUIRED)
        expect(result.message).toContain('Feature degradation: lists_api')
        expect(result.suggestion).toContain('CLOUDFLARE_ACCOUNT_ID')
        expect(result.suggestion).toContain('Fallback: Using individual IP rules instead')
        expect(result.suggestion).toContain('Impact: May be slower for large IP lists')
      })

      it('should handle unsupported features with alternative suggestions', () => {
        const result = CloudflareErrorHandler.handleGracefulDegradation(
          'managed_rules',
          'Not supported in Cloudflare',
          'Use custom rules with equivalent conditions',
          'Manual rule creation required',
        )

        expect(result.code).toBe(CloudflareErrorCode.FEATURE_UNSUPPORTED)
        expect(result.suggestion).toContain('custom rules with equivalent conditions')
        expect(result.suggestion).toContain('Fallback: Use custom rules with equivalent conditions')
      })
    })
  })

  describe('Error Recovery and Cleanup', () => {
    it('should handle interrupted operations gracefully', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [{ id: 'ip-1', ip: '192.168.1.1', action: 'deny' }],
      }

      // Simulate operation interruption
      let operationStarted = false
      fetchMock.mockImplementation(async () => {
        operationStarted = true
        throw new Error('Operation interrupted')
      })

      try {
        await service.syncRules(mockConfig)
      } catch (error) {
        expect(operationStarted).toBe(true)
        expect(error).toBeInstanceOf(Error)
      }
    })

    it('should provide recovery suggestions for failed operations', () => {
      const apiError: CloudflareApiError = {
        status: 500,
        code: 0,
        message: 'Internal server error during rule creation',
        endpoint: '/zones/test/rulesets',
      }

      const result = CloudflareErrorHandler.handleApiError(apiError)
      expect(result.suggestion).toContain('temporary')
      expect(result.suggestion).toContain('try again')
      expect(result.details?.statusPage).toBeDefined()
    })
  })

  describe('User-Friendly Error Messages', () => {
    it('should create contextual error messages for different operations', () => {
      const testCases = [
        {
          operation: 'syncing rules',
          error: { status: 401, code: 10000, message: 'Invalid token' },
          expectedContext: 'API token in the Cloudflare dashboard',
        },
        {
          operation: 'fetching configuration',
          error: { status: 404, code: 0, message: 'Zone not found' },
          expectedContext: 'may have been deleted or moved',
        },
        {
          operation: 'creating ruleset',
          error: { status: 403, code: 10001, message: 'Insufficient permissions' },
          expectedContext: 'required permissions',
        },
      ]

      testCases.forEach(({ operation, error, expectedContext }) => {
        const message = CloudflareErrorHandler.createUserFriendlyMessage(operation, error as CloudflareApiError, {
          zoneId: 'test-zone',
        })

        expect(message).toContain(`Failed to ${operation}`)
        expect(message).toContain('zoneId: test-zone')
        expect(message).toContain(expectedContext)
      })
    })

    it('should provide operation-specific suggestions', () => {
      const operations = [
        'syncing rules',
        'fetching configuration',
        'validating credentials',
        'creating ruleset',
        'updating rules',
      ]

      operations.forEach((operation) => {
        const error = new Error('Test error')
        const result = CloudflareErrorHandler.handleNetworkError(error, operation)

        expect(result.suggestion).toContain('internet connection')
        // Each operation should have specific additional guidance
        expect((result.suggestion || '').length).toBeGreaterThan(50)
      })
    })
  })
})
