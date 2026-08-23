import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { CloudflareClient } from '../CloudflareClient'
import { DoormanError } from '../../../errors'
import type { CloudflareAPIResponse, CloudflareRuleset } from '../../../types/cloudflare'

// Mock logger
jest.mock('../../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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

describe('CloudflareClient - Edge Cases', () => {
  const API_TOKEN = 'test-token'
  const ZONE_ID = 'test-zone-id'
  const ACCOUNT_ID = 'test-account-id'

  let client: CloudflareClient
  let fetchMock: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    client = new CloudflareClient(API_TOKEN, ZONE_ID, ACCOUNT_ID)
    fetchMock = jest.spyOn(globalThis, 'fetch')
    jest.spyOn(CloudflareClient.prototype as any, 'delay').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Error Handling', () => {
    it('should throw DoormanError on API failure', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [{ code: 7003, message: 'Authentication failed' }],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 403, jsonBody: mockResponse }))

      try {
        await client.listRulesets()
        // Should not reach here

        fail('Expected listRulesets to throw')
      } catch (error) {
        expect(DoormanError.isDoormanError(error)).toBe(true)
        if (DoormanError.isDoormanError(error)) {
          expect(error.message).toContain('Authentication failed')
        }
      }
    })

    it('should include error code in DoormanError', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [{ code: 10000, message: 'Invalid zone' }],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 400, jsonBody: mockResponse }))

      try {
        await client.listRulesets()
        fail('Should have thrown')
      } catch (error) {
        expect(DoormanError.isDoormanError(error)).toBe(true)
        if (DoormanError.isDoormanError(error)) {
          expect(error.details).toHaveProperty('endpoint')
        }
      }
    })

    it('should handle multiple API errors', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [
          { code: 7003, message: 'Authentication failed' },
          { code: 7000, message: 'Invalid API token' },
        ],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 403, jsonBody: mockResponse }))

      await expect(client.listRulesets()).rejects.toThrow('Authentication failed')
    })

    it('should handle empty error array', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 500, jsonBody: mockResponse }))

      await expect(client.listRulesets()).rejects.toThrow()
    })
  })

  describe('Account ID Validation', () => {
    it('should throw DoormanError when account ID missing for Lists operations', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(clientWithoutAccount.getList('list-1')).rejects.toThrow(DoormanError)
      await expect(clientWithoutAccount.getList('list-1')).rejects.toThrow('Account ID required')
    })

    it('should return empty array for listLists without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      const result = await clientWithoutAccount.listLists()

      expect(result).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should throw DoormanError for getOrCreateIPBlocklist without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(clientWithoutAccount.getOrCreateIPBlocklist()).rejects.toThrow(DoormanError)
    })

    it('should throw for createList without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(
        clientWithoutAccount.createList({
          name: 'Test List',
          kind: 'ip',
          description: 'Test',
        }),
      ).rejects.toThrow('Account ID required')
    })

    it('should throw for updateList without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(
        clientWithoutAccount.updateList('list-1', {
          description: 'Updated',
        }),
      ).rejects.toThrow('Account ID required')
    })

    it('should throw for deleteList without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(clientWithoutAccount.deleteList('list-1')).rejects.toThrow('Account ID required')
    })

    it('should throw for getListItems without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(clientWithoutAccount.getListItems('list-1')).rejects.toThrow('Account ID required')
    })

    it('should throw for addListItems without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(
        clientWithoutAccount.addListItems('list-1', {
          items: [{ ip: '1.2.3.4' }],
        }),
      ).rejects.toThrow('Account ID required')
    })

    it('should throw for removeListItems without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(
        clientWithoutAccount.removeListItems('list-1', {
          items: [{ id: 'item-1' }],
        }),
      ).rejects.toThrow('Account ID required')
    })
  })

  describe('Credential Verification', () => {
    it('should return true when credentials are valid', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.verifyCredentials()

      expect(result).toBe(true)
    })

    it('should return false when credentials are invalid', async () => {
      // mockRejectedValue (not Once): verifyCredentials -> listRulesets goes
      // through makeRequest's retry loop (3 retries by default), so a single
      // Once-rejection only covers the first attempt — the rest silently
      // fall through jest.spyOn's default of calling the real fetch(). That
      // was invisible while a since-fixed bug (forbidden Connection/
      // Keep-Alive headers) made every real fetch() call throw immediately
      // for an unrelated reason; once real network calls could succeed
      // again, this test started making an actual call to Cloudflare's API
      // in any environment with real outbound access (CI), which returns a
      // real error whose message can trip verifyCredentials' zone/forbidden
      // matching and throw instead of returning false.
      fetchMock.mockRejectedValue(new Error('Authentication failed'))

      const result = await client.verifyCredentials()

      expect(result).toBe(false)
    })

    it('should return false on network error', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'))

      const result = await client.verifyCredentials()

      expect(result).toBe(false)
    })
  })

  describe('getOrCreateFirewallRuleset', () => {
    it('should return existing ruleset when found', async () => {
      const existingRuleset: CloudflareRuleset = {
        id: 'existing-id',
        name: 'Existing Ruleset',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [existingRuleset],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.getOrCreateFirewallRuleset()

      expect(result).toEqual(existingRuleset)
      expect(fetchMock).toHaveBeenCalledTimes(1) // Only list, no create
    })

    it('should create new ruleset when none exists', async () => {
      const listResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [],
      }

      const newRuleset: CloudflareRuleset = {
        id: 'new-id',
        name: 'Doorman Custom Firewall Rules',
        description: 'Custom firewall rules managed by Doorman',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      const createResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: newRuleset,
      }

      fetchMock
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: listResponse }))
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: createResponse }))

      const result = await client.getOrCreateFirewallRuleset()

      expect(result.name).toBe('Doorman Custom Firewall Rules')
      expect(fetchMock).toHaveBeenCalledTimes(2) // List + create
    })

    it('should ignore non-custom or non-firewall rulesets', async () => {
      const managedRuleset: CloudflareRuleset = {
        id: 'managed-id',
        name: 'Managed Ruleset',
        description: 'Test',
        kind: 'managed',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      const wrongPhaseRuleset: CloudflareRuleset = {
        id: 'wrong-phase-id',
        name: 'Wrong Phase',
        description: 'Test',
        kind: 'custom',
        phase: 'http_request_transform',
        version: '1',
        rules: [],
      }

      const listResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [managedRuleset, wrongPhaseRuleset],
      }

      const newRuleset: CloudflareRuleset = {
        id: 'new-id',
        name: 'Doorman Custom Firewall Rules',
        description: 'Custom firewall rules managed by Doorman',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      const createResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: newRuleset,
      }

      fetchMock
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: listResponse }))
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: createResponse }))

      const result = await client.getOrCreateFirewallRuleset()

      expect(result.kind).toBe('custom')
      expect(result.phase).toBe('http_request_firewall_custom')
    })
  })

  describe('getOrCreateIPBlocklist', () => {
    it('should return existing IP blocklist when found', async () => {
      const existingList = {
        id: 'existing-list-id',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'ip' as const,
        num_items: 10,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const mockResponse = {
        success: true,
        errors: [],
        messages: [],
        result: [existingList],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.getOrCreateIPBlocklist()

      expect(result).toEqual(existingList)
      expect(fetchMock).toHaveBeenCalledTimes(1) // Only list, no create
    })

    it('should create new IP blocklist when none exists', async () => {
      const listResponse = {
        success: true,
        errors: [],
        messages: [],
        result: [],
      }

      const newList = {
        id: 'new-list-id',
        name: 'Doorman IP Blocklist',
        description: 'IP addresses blocked by Doorman',
        kind: 'ip' as const,
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const createResponse = {
        success: true,
        errors: [],
        messages: [],
        result: newList,
      }

      fetchMock
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: listResponse }))
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: createResponse }))

      const result = await client.getOrCreateIPBlocklist()

      expect(result.name).toBe('Doorman IP Blocklist')
      expect(result.kind).toBe('ip')
      expect(fetchMock).toHaveBeenCalledTimes(2) // List + create
    })

    it('should ignore lists with different names or kinds', async () => {
      const wrongNameList = {
        id: 'wrong-name-id',
        name: 'Other Blocklist',
        description: 'Test',
        kind: 'ip' as const,
        num_items: 10,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const wrongKindList = {
        id: 'wrong-kind-id',
        name: 'Doorman IP Blocklist',
        description: 'Test',
        kind: 'asn' as const,
        num_items: 10,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const listResponse = {
        success: true,
        errors: [],
        messages: [],
        result: [wrongNameList, wrongKindList],
      }

      const newList = {
        id: 'new-list-id',
        name: 'Doorman IP Blocklist',
        description: 'IP addresses blocked by Doorman',
        kind: 'ip' as const,
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const createResponse = {
        success: true,
        errors: [],
        messages: [],
        result: newList,
      }

      fetchMock
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: listResponse }))
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: createResponse }))

      const result = await client.getOrCreateIPBlocklist()

      expect(result.name).toBe('Doorman IP Blocklist')
      expect(result.kind).toBe('ip')
    })
  })
})
