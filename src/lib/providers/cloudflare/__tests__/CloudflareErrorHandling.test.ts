import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareClient } from '../CloudflareClient'
import { CloudflareFirewallService } from '../CloudflareFirewallService'
import type { CloudflareAPIResponse } from '../../../types/cloudflare'
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

// Helper to build Response-like objects
const makeResponse = (init: {
  ok: boolean
  status: number
  statusText?: string
  jsonBody?: unknown
  headers?: Record<string, string>
}): Response => {
  const headers = new Headers(init.headers || {})
  const body = init.jsonBody
  const res = {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText || '',
    headers,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
  return res
}

describe('Cloudflare Error Handling Integration', () => {
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
    // Mock delay to avoid real timeouts in retry logic
    jest.spyOn(CloudflareClient.prototype as any, 'delay').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Authentication Error Scenarios', () => {
    it('should handle invalid API token with proper error mapping', async () => {
      const mockResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10000, message: 'Invalid API token' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 401,
          jsonBody: mockResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle token with insufficient permissions', async () => {
      const mockResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10001, message: 'Insufficient permissions for zone' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 403,
          jsonBody: mockResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle expired tokens gracefully', async () => {
      const mockResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10000, message: 'Token has expired' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 401,
          jsonBody: mockResponse,
        }),
      )

      await expect(client.verifyCredentials()).resolves.toBe(false)
    })
  })

  describe('Rate Limiting Error Scenarios', () => {
    it('should handle rate limiting with retry-after header', async () => {
      const mockResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10013, message: 'Rate limit exceeded' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          jsonBody: mockResponse,
          headers: { 'Retry-After': '120' },
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle burst rate limiting', async () => {
      const mockResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10013, message: 'Too many requests in short period' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          jsonBody: mockResponse,
        }),
      )

      await expect(
        client.createRuleset({
          name: 'Test Ruleset',
          kind: 'custom',
          phase: 'http_request_firewall_custom',
          description: 'Test',
          rules: [],
        }),
      ).rejects.toThrow()
    })
  })

  describe('Network Error Scenarios', () => {
    // mockRejectedValue (not Once): a one-shot rejection only covers
    // makeRequest's first retry attempt, letting the rest fall through to a
    // real fetch() call against the live Cloudflare API — see the identical
    // comment on verifyCredentials in CloudflareClient.test.ts.
    it('should handle DNS resolution failures', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND api.cloudflare.com')
      fetchMock.mockRejectedValue(dnsError)

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle connection timeouts', async () => {
      const timeoutError = new Error('Request timeout after 30000ms')
      fetchMock.mockRejectedValue(timeoutError)

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle connection refused errors', async () => {
      const connError = new Error('connect ECONNREFUSED 127.0.0.1:443')
      fetchMock.mockRejectedValue(connError)

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle SSL/TLS errors', async () => {
      const sslError = new Error('certificate verify failed')
      fetchMock.mockRejectedValue(sslError)

      await expect(client.listRulesets()).rejects.toThrow()
    })
  })

  describe('API Response Error Scenarios', () => {
    it('should handle malformed JSON responses', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          jsonBody: 'invalid json{',
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle missing required fields in response', async () => {
      const incompleteResponse = {
        success: true,
        // Missing errors, messages, result fields
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          jsonBody: incompleteResponse,
        }),
      )

      // When success is true but result is missing/undefined, listRulesets returns empty array
      const result = await client.listRulesets()
      expect(result).toEqual([])
    })

    it('should handle unexpected response structure', async () => {
      const unexpectedResponse = {
        data: [], // Wrong structure
        status: 'ok',
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          jsonBody: unexpectedResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })
  })

  describe('Service-Level Error Handling', () => {
    // mockRejectedValue (not Once): same reasoning as Network Error Scenarios above.
    it('should handle fetchConfig errors gracefully', async () => {
      const networkError = new Error('Network unavailable')
      fetchMock.mockRejectedValue(networkError)

      await expect(service.fetchConfig()).rejects.toThrow()
    })

    it('should handle syncRules errors with proper cleanup', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [],
      }

      const serverError = new Error('Internal server error')
      fetchMock.mockRejectedValue(serverError)

      await expect(service.syncRules(mockConfig)).rejects.toThrow()
    })

    it('should handle partial failures during sync', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'ip-1',
            ip: '192.168.1.1',
            action: 'deny',
          },
        ],
      }

      // Mock successful ruleset list (getOrCreateFirewallRuleset → listRulesets)
      const rulesetResponse: CloudflareAPIResponse<any> = {
        success: true,
        errors: [],
        messages: [],
        result: [
          {
            id: 'ruleset-1',
            name: 'Test Ruleset',
            kind: 'custom',
            phase: 'http_request_firewall_custom',
            version: '1',
            rules: [],
          },
        ],
      }

      // Mock Lists API failure (getOrCreateIPBlocklist → listLists)
      const listErrorResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10037, message: 'List quota exceeded' }],
        messages: [],
        result: null,
      }

      // Mock successful ruleset update (updateRuleset)
      const updateResponse: CloudflareAPIResponse<any> = {
        success: true,
        errors: [],
        messages: [],
        result: {
          id: 'ruleset-1',
          name: 'Test Ruleset',
          kind: 'custom',
          phase: 'http_request_firewall_custom',
          version: '2',
          rules: [],
        },
      }

      fetchMock
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: rulesetResponse }))
        .mockResolvedValueOnce(makeResponse({ ok: false, status: 400, jsonBody: listErrorResponse }))
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: updateResponse }))

      // Should fall back to individual IP rules when Lists API fails
      const result = await service.syncRules(mockConfig)
      expect(result.success).toBe(true)
    })
  })

  describe('Validation Error Scenarios', () => {
    it('should handle invalid rule expressions', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [
          {
            id: 'invalid-rule',
            name: 'Invalid Rule',
            enabled: true,
            action: { type: 'deny' },
            conditions: [], // No conditions - will cause validation error
          },
        ],
        ips: [],
      }

      const validationResult = service.validateConfig(mockConfig)
      expect(validationResult.valid).toBe(false)
      expect(validationResult.errors.some((e) => e.code === 'CF_6007')).toBe(true)
    })

    it('should handle invalid IP addresses', async () => {
      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: [],
        ips: [
          {
            id: 'invalid-ip',
            ip: '999.999.999.999', // Invalid IP
            action: 'deny',
          },
        ],
      }

      const validationResult = service.validateConfig(mockConfig)
      expect(validationResult.valid).toBe(false)
      expect(validationResult.errors.some((e) => e.code === 'CF_6013')).toBe(true)
    })

    it('should handle rule limit exceeded', async () => {
      const tooManyRules = Array.from({ length: 150 }, (_, i) => ({
        id: `rule-${i}`,
        name: `Rule ${i}`,
        enabled: true,
        action: { type: 'deny' as const },
        conditions: [{ field: 'path', operator: 'eq' as const, value: `/path-${i}` }],
      }))

      const mockConfig: UnifiedConfig = {
        version: '2.0',
        provider: 'cloudflare',
        rules: tooManyRules,
        ips: [],
      }

      const validationResult = service.validateConfig(mockConfig)
      expect(validationResult.valid).toBe(false)
      expect(validationResult.errors.some((e) => e.code === 'CF_6001')).toBe(true)
    })
  })

  describe('Recovery and Retry Scenarios', () => {
    it('should handle temporary server errors', async () => {
      const serverErrorResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 0, message: 'Internal server error' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 500,
          jsonBody: serverErrorResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle service unavailable errors', async () => {
      const serviceUnavailableResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 0, message: 'Service temporarily unavailable' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 503,
          jsonBody: serviceUnavailableResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle gateway timeout errors', async () => {
      const timeoutResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 0, message: 'Gateway timeout' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 504,
          jsonBody: timeoutResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })
  })

  describe('Edge Case Error Scenarios', () => {
    it('should handle empty error arrays in API responses', async () => {
      const emptyErrorResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [], // Empty errors array
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 400,
          jsonBody: emptyErrorResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle multiple error codes in single response', async () => {
      const multiErrorResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [
          { code: 10000, message: 'Authentication failed' },
          { code: 10001, message: 'Insufficient permissions' },
          { code: 81044, message: 'Ruleset not found' },
        ],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 403,
          jsonBody: multiErrorResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle null/undefined error messages', async () => {
      const nullMessageResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [
          { code: 10000, message: null as any },
          { code: 10001, message: undefined as any },
        ],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 400,
          jsonBody: nullMessageResponse,
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })
  })

  describe('Lists API Specific Error Scenarios', () => {
    it('should handle Lists API quota exceeded', async () => {
      const quotaErrorResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10037, message: 'List quota exceeded for account' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 400,
          jsonBody: quotaErrorResponse,
        }),
      )

      await expect(
        client.createList({
          name: 'Test List',
          description: 'Test',
          kind: 'ip',
        }),
      ).rejects.toThrow()
    })

    it('should handle invalid list item formats', async () => {
      const invalidItemResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10038, message: 'Invalid IP address format in list item' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 400,
          jsonBody: invalidItemResponse,
        }),
      )

      await expect(
        client.addListItems('test-list', {
          items: [{ ip: 'invalid-ip', comment: 'Bad IP' }],
        }),
      ).rejects.toThrow()
    })

    it('should handle list not found errors', async () => {
      const notFoundResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 10036, message: 'List not found' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 404,
          jsonBody: notFoundResponse,
        }),
      )

      await expect(client.getList('non-existent-list')).rejects.toThrow()
    })
  })
})
