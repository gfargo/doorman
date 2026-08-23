import { CloudflareValidator } from '../CloudflareValidator'
import type { CloudflareCredentials } from '../CloudflareValidator'

// Mock logger
jest.mock('../../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Mock CloudflareClient
jest.mock('../CloudflareClient', () => ({
  CloudflareClient: jest.fn().mockImplementation(() => ({
    listRulesets: jest.fn(),
    listLists: jest.fn(),
  })),
}))

// Mock fetch globally. Unlike jest.spyOn(globalThis, 'fetch') used elsewhere,
// this replaces fetch outright, so mockRejectedValueOnce() below is safe even
// though it's single-shot: CloudflareValidator's own fetch() calls don't
// retry, and the separately-mocked CloudflareClient (which does) never
// touches fetch in this file.
const mockFetch = jest.fn() as jest.Mock
global.fetch = mockFetch as any

describe('CloudflareValidator', () => {
  let validator: CloudflareValidator
  let mockClient: any

  beforeEach(() => {
    validator = new CloudflareValidator('test-token', 'zone123', 'account123')
    mockFetch.mockClear()

    // Get the mocked CloudflareClient constructor
    const { CloudflareClient } = require('../CloudflareClient')
    mockClient = {
      listRulesets: jest.fn(),
      listLists: jest.fn(),
    }
    CloudflareClient.mockImplementation(() => mockClient)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('validateCredentials', () => {
    const validCredentials: CloudflareCredentials = {
      apiToken: 'valid-token-12345678901234567890',
      zoneId: 'zone123',
      accountId: 'account123',
    }

    it('should validate valid credentials successfully', async () => {
      // Mock successful token verification
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'token123',
            status: 'active',
            policies: [
              {
                id: 'policy1',
                effect: 'allow',
                resources: {
                  'com.cloudflare.api.account.zone': 'zone123',
                  'com.cloudflare.api.account': 'account123',
                },
                permission_groups: [
                  { id: 'zone_edit', name: 'Zone:Edit' },
                  { id: 'account_read', name: 'Account:Read' },
                ],
              },
            ],
          },
        }),
      })

      // Mock successful zone info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'zone123',
            name: 'example.com',
            status: 'active',
            permissions: ['zone:edit'],
          },
        }),
      })

      // Mock successful account info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'account123',
            name: 'Test Account',
            permissions: ['account:read'],
          },
        }),
      })

      // Mock successful client operations
      mockClient.listRulesets.mockResolvedValue([])
      mockClient.listLists.mockResolvedValue([])

      const result = await validator.validateCredentials(validCredentials)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.suggestions).toContain('All credentials are valid and properly configured')
    })

    it('should fail validation for invalid token format', async () => {
      const invalidCredentials: CloudflareCredentials = {
        apiToken: 'Bearer invalid-token',
        zoneId: 'zone123',
      }

      const result = await validator.validateCredentials(invalidCredentials)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'apiToken',
            message: 'API token should not include "Bearer " prefix',
          }),
        ]),
      )
    })

    it('should fail validation for empty token', async () => {
      const invalidCredentials: CloudflareCredentials = {
        apiToken: '',
        zoneId: 'zone123',
      }

      const result = await validator.validateCredentials(invalidCredentials)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'apiToken',
            message: 'API token is required',
          }),
        ]),
      )
    })

    it('should fail validation for invalid API token', async () => {
      // Mock failed token verification
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      const result = await validator.validateCredentials(validCredentials)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'apiToken',
            message: expect.stringContaining('Failed to verify API token'),
          }),
        ]),
      )
    })

    it('should handle network errors during validation', async () => {
      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await validator.validateCredentials(validCredentials)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'apiToken',
            message: expect.stringContaining('Failed to verify API token'),
          }),
        ]),
      )
    })

    it('should warn when account ID is not provided', async () => {
      const credentialsWithoutAccount: CloudflareCredentials = {
        apiToken: 'valid-token-12345678901234567890',
        zoneId: 'zone123',
      }

      // Mock successful token verification
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'token123',
            status: 'active',
            policies: [
              {
                id: 'policy1',
                effect: 'allow',
                resources: {
                  'com.cloudflare.api.account.zone': 'zone123',
                },
                permission_groups: [{ id: 'zone_edit', name: 'Zone:Edit' }],
              },
            ],
          },
        }),
      })

      // Mock successful zone info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'zone123',
            name: 'example.com',
            status: 'active',
            permissions: ['zone:edit'],
          },
        }),
      })

      mockClient.listRulesets.mockResolvedValue([])

      const result = await validator.validateCredentials(credentialsWithoutAccount)

      expect(result.valid).toBe(true)
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'accountId',
            message: 'Account ID not provided',
            impact: expect.stringContaining('Lists API will not be available'),
          }),
        ]),
      )
      expect(result.suggestions).toContain(
        'Consider providing CLOUDFLARE_ACCOUNT_ID for better performance with large IP lists',
      )
    })
  })

  describe('validateZoneAccess', () => {
    const validToken = 'valid-token-12345678901234567890'
    const validZoneId = 'zone123'

    it('should validate zone access successfully', async () => {
      // Mock successful zone info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'zone123',
            name: 'example.com',
            status: 'active',
            permissions: ['zone:edit'],
          },
        }),
      })

      mockClient.listRulesets.mockResolvedValue([])

      const result = await validator.validateZoneAccess(validZoneId, validToken)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail validation for non-existent zone', async () => {
      // Mock 404 response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const result = await validator.validateZoneAccess('invalid-zone', validToken)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'zoneId',
            message: 'Zone not found or not accessible',
          }),
        ]),
      )
    })

    it('should warn for inactive zone status', async () => {
      // Mock zone with pending status
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'zone123',
            name: 'example.com',
            status: 'pending',
            permissions: ['zone:edit'],
          },
        }),
      })

      mockClient.listRulesets.mockResolvedValue([])

      const result = await validator.validateZoneAccess(validZoneId, validToken)

      expect(result.valid).toBe(true)
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'zoneId',
            message: "Zone status is 'pending' instead of 'active'",
          }),
        ]),
      )
      expect(result.suggestions).toContain('Complete the zone setup in Cloudflare dashboard to activate the zone')
    })

    it('should handle insufficient permissions for zone operations', async () => {
      // Mock successful zone info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'zone123',
            name: 'example.com',
            status: 'active',
            permissions: ['zone:read'],
          },
        }),
      })

      // Mock permission error for listRulesets
      const permissionError = new Error('Insufficient permissions')
      mockClient.listRulesets.mockRejectedValue(permissionError)

      const result = await validator.validateZoneAccess(validZoneId, validToken)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'zoneId',
            message: 'Insufficient permissions for zone operations',
          }),
        ]),
      )
    })
  })

  describe('validateAccountAccess', () => {
    const validToken = 'valid-token-12345678901234567890'
    const validAccountId = 'account123'

    it('should validate account access successfully', async () => {
      // Mock successful account info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'account123',
            name: 'Test Account',
            permissions: ['account:read'],
          },
        }),
      })

      mockClient.listLists.mockResolvedValue([])

      const result = await validator.validateAccountAccess(validAccountId, validToken)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.suggestions).toContain('Lists API is available and can be used for efficient IP blocking')
    })

    it('should fail validation for non-existent account', async () => {
      // Mock 404 response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const result = await validator.validateAccountAccess('invalid-account', validToken)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'accountId',
            message: 'Account not found or not accessible',
          }),
        ]),
      )
    })

    it('should handle insufficient permissions for Lists API', async () => {
      // Mock successful account info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'account123',
            name: 'Test Account',
            permissions: ['account:read'],
          },
        }),
      })

      // Mock permission error for listLists
      const permissionError = new Error('Insufficient permissions')
      mockClient.listLists.mockRejectedValue(permissionError)

      const result = await validator.validateAccountAccess(validAccountId, validToken)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'accountId',
            message: 'Insufficient permissions for Lists API',
          }),
        ]),
      )
    })

    it('should warn when Lists API is not available', async () => {
      // Mock successful account info
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'account123',
            name: 'Test Account',
            permissions: ['account:read'],
          },
        }),
      })

      // Mock generic error for listLists (not permission-related)
      mockClient.listLists.mockRejectedValue(new Error('Lists API not available'))

      const result = await validator.validateAccountAccess(validAccountId, validToken)

      expect(result.valid).toBe(true)
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'accountId',
            message: expect.stringContaining('Could not verify Lists API access'),
            impact: 'Lists API may not be available, falling back to individual IP rules',
          }),
        ]),
      )
    })
  })

  describe('token format validation', () => {
    it('should accept valid token formats', async () => {
      const validTokens = [
        'abcdef1234567890abcdef1234567890abcdef12',
        'token-with-hyphens-123456789012345678',
        'token_with_underscores_123456789012345',
        'MixedCaseToken123456789012345678901234',
      ]

      for (const token of validTokens) {
        // Mock successful API responses for each token
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              success: true,
              result: {
                id: 'token123',
                status: 'active',
                policies: [
                  {
                    id: 'policy1',
                    effect: 'allow',
                    resources: { 'com.cloudflare.api.account.zone': 'zone123' },
                    permission_groups: [{ id: 'zone_edit', name: 'Zone:Edit' }],
                  },
                ],
              },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              success: true,
              result: { id: 'zone123', name: 'example.com', status: 'active', permissions: [] },
            }),
          })

        mockClient.listRulesets.mockResolvedValue([])

        const result = await validator.validateCredentials({
          apiToken: token,
          zoneId: 'zone123',
        })

        // Should not have format-related errors
        const formatErrors = result.errors.filter(
          (e) => e.message.includes('format') || e.message.includes('Bearer') || e.message.includes('too short'),
        )
        expect(formatErrors).toHaveLength(0)
      }
    })

    it('should reject invalid token formats', async () => {
      const invalidTokens = [
        { token: '', expectedError: 'API token is required' },
        { token: '   ', expectedError: 'API token is required' },
        { token: 'Bearer valid-token-123456789012345678', expectedError: 'should not include "Bearer " prefix' },
        { token: 'short', expectedError: 'appears to be too short' },
      ]

      for (const { token, expectedError } of invalidTokens) {
        const result = await validator.validateCredentials({
          apiToken: token,
          zoneId: 'zone123',
        })

        expect(result.valid).toBe(false)
        const hasExpectedError =
          result.errors.some((e) => e.message.includes(expectedError)) ||
          result.warnings.some((w) => w.message.includes(expectedError))
        expect(hasExpectedError).toBe(true)
      }
    })
  })

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      const credentials: CloudflareCredentials = {
        apiToken: 'valid-token-12345678901234567890',
        zoneId: 'zone123',
      }

      // Mock an unexpected error
      mockFetch.mockRejectedValueOnce(new Error('Unexpected error'))

      const result = await validator.validateCredentials(credentials)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'apiToken',
            message: expect.stringContaining('Failed to verify API token'),
          }),
        ]),
      )
    })

    it('should provide helpful suggestions for common errors', async () => {
      const credentials: CloudflareCredentials = {
        apiToken: 'valid-token-12345678901234567890',
        zoneId: 'zone123',
      }

      // Mock token verification success but zone access failure
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            result: {
              id: 'token123',
              status: 'active',
              policies: [
                {
                  id: 'policy1',
                  effect: 'allow',
                  resources: { 'com.cloudflare.api.account.zone': 'other-zone' },
                  permission_groups: [{ id: 'zone_edit', name: 'Zone:Edit' }],
                },
              ],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            result: { id: 'zone123', name: 'example.com', status: 'active', permissions: [] },
          }),
        })

      mockClient.listRulesets.mockResolvedValue([])

      const result = await validator.validateCredentials(credentials)

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'zoneId',
            message: 'Zone ID is not accessible with the provided API token',
            suggestion: expect.stringContaining('Ensure the API token has permissions for this zone'),
          }),
        ]),
      )
    })
  })
})
