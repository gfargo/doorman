import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudflareClient } from '../CloudflareClient'
import type {
  CloudflareRuleset,
  CloudflareAPIResponse,
  CloudflareList,
  CloudflareListItem,
  CloudflareRule,
} from '../../../types/cloudflare'

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

describe('CloudflareClient', () => {
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

  describe('Authentication', () => {
    it('should include Bearer token in Authorization header', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      await client.listRulesets()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const callArgs = fetchMock.mock.calls[0]
      const requestInit = callArgs?.[1] as RequestInit
      const headers = requestInit.headers as Record<string, string>
      expect(headers['Authorization']).toBe(`Bearer ${API_TOKEN}`)
    })

    it('should never send Connection or Keep-Alive request headers', async () => {
      // Regression test: getAuthHeaders() used to spread in
      // CloudflareOptimizer.getConnectionHeaders(), which set these as
      // per-request headers. Both are on the Fetch spec's forbidden-header
      // list — undici's fetch() throws ("invalid keep-alive header") the
      // moment either is present, so every real Cloudflare API call failed
      // outright. Confirmed against a live local server, not just this
      // mocked fetch: see demos/cloudflare-mock-server.mjs.
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      await client.listRulesets()

      const callArgs = fetchMock.mock.calls[0]
      const requestInit = callArgs?.[1] as RequestInit
      const headers = requestInit.headers as Record<string, string>
      expect(headers).not.toHaveProperty('Connection')
      expect(headers).not.toHaveProperty('Keep-Alive')
    })
  })

  describe('Ruleset Operations', () => {
    it('should list all rulesets', async () => {
      const mockRulesets: CloudflareRuleset[] = [
        {
          id: 'ruleset-1',
          name: 'Test Ruleset',
          description: 'Test Description',
          kind: 'custom',
          phase: 'http_request_firewall_custom',
          version: '1',
          rules: [],
        },
      ]

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: mockRulesets,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.listRulesets()

      expect(result).toEqual(mockRulesets)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}/rulesets`)
    })

    it('should get a specific ruleset by ID', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test Description',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [],
      }

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: mockRuleset,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.getRuleset('ruleset-1')

      expect(result).toEqual(mockRuleset)
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}/rulesets/ruleset-1`)
    })

    it('should create a new ruleset', async () => {
      const newRuleset = {
        name: 'New Ruleset',
        kind: 'custom' as const,
        phase: 'http_request_firewall_custom' as const,
        description: 'New Description',
        rules: [],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'new-ruleset-id',
        ...newRuleset,
        version: '1',
      }

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: mockRuleset,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.createRuleset(newRuleset)

      expect(result).toEqual(mockRuleset)
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}/rulesets`)
    })

    it('should update an existing ruleset', async () => {
      const updateData = {
        rules: [
          {
            id: 'rule-1',
            action: 'block' as const,
            expression: 'http.request.uri.path eq "/blocked"',
            description: 'Block specific path',
            enabled: true,
          },
        ],
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test Description',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '2',
        rules: updateData.rules,
      }

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: mockRuleset,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.updateRuleset('ruleset-1', updateData)

      expect(result.version).toBe('2')
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}/rulesets/ruleset-1`)
    })

    it('should delete a ruleset', async () => {
      const mockResponse: CloudflareAPIResponse<void> = {
        success: true,
        errors: [],
        messages: [],
        result: undefined,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      await client.deleteRuleset('ruleset-1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}/rulesets/ruleset-1`)
    })

    it('should handle API errors when listing rulesets', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [{ code: 7003, message: 'Authentication failed' }],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 403, jsonBody: mockResponse }))

      await expect(client.listRulesets()).rejects.toThrow('Authentication failed')
    })
  })

  describe('Rule Operations', () => {
    it('should create a rule in a ruleset', async () => {
      const newRule = {
        action: 'block' as const,
        expression: 'http.request.uri.path eq "/api/test"',
        description: 'Block test API',
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test Description',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '2',
        rules: [{ ...newRule, id: 'rule-1' }],
      }

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: mockRuleset,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.createRule('ruleset-1', newRule)

      expect(result.rules).toHaveLength(1)
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}/rulesets/ruleset-1/rules`)
    })

    it('should update a rule in a ruleset', async () => {
      const updateData = {
        action: 'challenge' as const,
        expression: 'http.request.uri.path eq "/api/test"',
        description: 'Challenge test API',
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test Description',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '3',
        rules: [{ ...updateData, id: 'rule-1' }],
      }

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: mockRuleset,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.updateRule('ruleset-1', 'rule-1', updateData)

      expect(result.rules[0]?.action).toBe('challenge')
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}/rulesets/ruleset-1/rules/rule-1`)
    })

    it('should delete a rule from a ruleset', async () => {
      const mockRuleset: CloudflareRuleset = {
        id: 'ruleset-1',
        name: 'Test Ruleset',
        description: 'Test Description',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '4',
        rules: [],
      }

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: mockRuleset,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.deleteRule('ruleset-1', 'rule-1')

      expect(result.rules).toHaveLength(0)
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}/rulesets/ruleset-1/rules/rule-1`)
    })
  })

  describe('getOrCreateFirewallRuleset', () => {
    it('should return existing custom firewall ruleset', async () => {
      const existingRuleset: CloudflareRuleset = {
        id: 'existing-ruleset',
        name: 'Existing Ruleset',
        description: 'Existing Description',
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

    it('should create new custom firewall ruleset if none exists', async () => {
      const listResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [], // No existing rulesets
      }

      const newRuleset: CloudflareRuleset = {
        id: 'new-ruleset',
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
  })

  describe('verifyCredentials', () => {
    it('should return true for valid credentials', async () => {
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

    it('should return false for invalid credentials', async () => {
      // mockRejectedValue (not Once): see the identical comment in
      // CloudflareEdgeCases.test.ts — a one-shot rejection only covers the
      // first of makeRequest's retry attempts, letting the rest fall through
      // to a real fetch() call.
      fetchMock.mockRejectedValue(new Error('Authentication failed'))

      const result = await client.verifyCredentials()

      expect(result).toBe(false)
    })

    it('never leaks a fragment of the real API token into debug logs (regression test for #101)', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [],
      }
      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      await client.verifyCredentials()
      // Second call hits the cache, which logs the cache key — the exact
      // path where a raw token substring used to leak (see #101).
      await client.verifyCredentials()

      const debugMock = require('../../../logger').logger.debug as jest.Mock
      const loggedText = debugMock.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
      // The cache key is derived from the token — assert it's not just the
      // token's own last 8 characters (the old "safe hash").
      expect(loggedText).not.toContain(API_TOKEN.slice(-8))
    })
  })

  describe('getZoneInfo', () => {
    it('should fetch zone information', async () => {
      const mockZoneInfo = {
        id: ZONE_ID,
        name: 'example.com',
      }

      const mockResponse: CloudflareAPIResponse<{ id: string; name: string }> = {
        success: true,
        errors: [],
        messages: [],
        result: mockZoneInfo,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.getZoneInfo()

      expect(result).toEqual(mockZoneInfo)
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/zones/${ZONE_ID}`)
    })
  })

  describe('Lists API Operations', () => {
    it('should list all Lists', async () => {
      const mockLists: CloudflareList[] = [
        {
          id: 'list-1',
          name: 'Test List',
          description: 'Test Description',
          kind: 'ip',
          num_items: 5,
          num_referencing_filters: 1,
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ]

      const mockResponse: CloudflareAPIResponse<CloudflareList[]> = {
        success: true,
        errors: [],
        messages: [],
        result: mockLists,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.listLists()

      expect(result).toEqual(mockLists)
      expect(fetchMock.mock.calls[0]?.[0]).toContain(`/accounts/${ACCOUNT_ID}/rules/lists`)
    })

    it('should return empty array if no account ID provided', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      const result = await clientWithoutAccount.listLists()

      expect(result).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should get a specific List by ID', async () => {
      const mockList: CloudflareList = {
        id: 'list-1',
        name: 'Test List',
        description: 'Test Description',
        kind: 'ip',
        num_items: 5,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const mockResponse: CloudflareAPIResponse<CloudflareList> = {
        success: true,
        errors: [],
        messages: [],
        result: mockList,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.getList('list-1')

      expect(result).toEqual(mockList)
    })

    it('should throw error when getting List without account ID', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(clientWithoutAccount.getList('list-1')).rejects.toThrow('Account ID required')
    })

    it('should create a new List', async () => {
      const newList = {
        name: 'New List',
        description: 'New Description',
        kind: 'ip' as const,
      }

      const mockList: CloudflareList = {
        id: 'new-list-id',
        ...newList,
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const mockResponse: CloudflareAPIResponse<CloudflareList> = {
        success: true,
        errors: [],
        messages: [],
        result: mockList,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.createList(newList)

      expect(result).toEqual(mockList)
    })

    it('should update a List', async () => {
      const updateData = {
        description: 'Updated Description',
      }

      const mockList: CloudflareList = {
        id: 'list-1',
        name: 'Test List',
        description: 'Updated Description',
        kind: 'ip',
        num_items: 5,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-02T00:00:00Z',
      }

      const mockResponse: CloudflareAPIResponse<CloudflareList> = {
        success: true,
        errors: [],
        messages: [],
        result: mockList,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.updateList('list-1', updateData)

      expect(result.description).toBe('Updated Description')
    })

    it('should delete a List', async () => {
      const mockResponse: CloudflareAPIResponse<void> = {
        success: true,
        errors: [],
        messages: [],
        result: undefined,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      await client.deleteList('list-1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should get List items', async () => {
      const mockItems: CloudflareListItem[] = [
        {
          id: 'item-1',
          ip: '192.168.1.1',
          comment: 'Test IP',
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ]

      const mockResponse = {
        success: true,
        errors: [],
        messages: [],
        result: mockItems,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.getListItems('list-1')

      expect(result).toEqual(mockItems)
    })

    // Regression test: getListItems previously issued a single unparameterized
    // GET and returned page 1 only, silently dropping items beyond it.
    it('paginates through every page of List items', async () => {
      const page1Items: CloudflareListItem[] = [
        { id: 'item-1', ip: '10.0.0.1', created_on: '2024-01-01T00:00:00Z', modified_on: '2024-01-01T00:00:00Z' },
      ]
      const page2Items: CloudflareListItem[] = [
        { id: 'item-2', ip: '10.0.0.2', created_on: '2024-01-01T00:00:00Z', modified_on: '2024-01-01T00:00:00Z' },
      ]
      const page3Items: CloudflareListItem[] = [
        { id: 'item-3', ip: '10.0.0.3', created_on: '2024-01-01T00:00:00Z', modified_on: '2024-01-01T00:00:00Z' },
      ]

      fetchMock
        .mockResolvedValueOnce(
          makeResponse({
            ok: true,
            status: 200,
            jsonBody: {
              success: true,
              errors: [],
              messages: [],
              result: page1Items,
              result_info: { count: 1, page: 1, per_page: 1, total_count: 3, total_pages: 3 },
            },
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            ok: true,
            status: 200,
            jsonBody: {
              success: true,
              errors: [],
              messages: [],
              result: page2Items,
              result_info: { count: 1, page: 2, per_page: 1, total_count: 3, total_pages: 3 },
            },
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            ok: true,
            status: 200,
            jsonBody: {
              success: true,
              errors: [],
              messages: [],
              result: page3Items,
              result_info: { count: 1, page: 3, per_page: 1, total_count: 3, total_pages: 3 },
            },
          }),
        )

      const result = await client.getListItems('multi-page-list')

      expect(result).toEqual([...page1Items, ...page2Items, ...page3Items])
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[0]?.[0]).toContain('page=1')
      expect(fetchMock.mock.calls[1]?.[0]).toContain('page=2')
      expect(fetchMock.mock.calls[2]?.[0]).toContain('page=3')
    })

    it('should add items to a List', async () => {
      const newItems = [
        {
          ip: '192.168.1.2',
          comment: 'New IP',
        },
      ]

      const mockItems: CloudflareListItem[] = [
        {
          id: 'item-2',
          ...newItems[0]!,
          created_on: '2024-01-01T00:00:00Z',
          modified_on: '2024-01-01T00:00:00Z',
        },
      ]

      const mockResponse = {
        success: true,
        errors: [],
        messages: [],
        result: mockItems,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.addListItems('list-1', { items: newItems })

      expect(result).toEqual(mockItems)
    })

    it('should remove items from a List', async () => {
      const itemsToRemove = {
        items: [{ id: 'item-1' }],
      }

      const mockResponse: CloudflareAPIResponse<void> = {
        success: true,
        errors: [],
        messages: [],
        result: undefined,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      await client.removeListItems('list-1', itemsToRemove)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('getOrCreateIPBlocklist', () => {
    it('should return existing IP blocklist', async () => {
      const existingList: CloudflareList = {
        id: 'existing-list',
        name: 'Doorman IP Blocklist',
        description: 'Existing blocklist',
        kind: 'ip',
        num_items: 10,
        num_referencing_filters: 1,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const mockResponse: CloudflareAPIResponse<CloudflareList[]> = {
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

    it('should create new IP blocklist if none exists', async () => {
      const listResponse: CloudflareAPIResponse<CloudflareList[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [], // No existing lists
      }

      const newList: CloudflareList = {
        id: 'new-list',
        name: 'Doorman IP Blocklist',
        description: 'IP addresses blocked by Doorman',
        kind: 'ip',
        num_items: 0,
        num_referencing_filters: 0,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }

      const createResponse: CloudflareAPIResponse<CloudflareList> = {
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
      expect(fetchMock).toHaveBeenCalledTimes(2) // List + create
    })

    it('should throw error if no account ID provided', async () => {
      const clientWithoutAccount = new CloudflareClient(API_TOKEN, ZONE_ID)

      await expect(clientWithoutAccount.getOrCreateIPBlocklist()).rejects.toThrow('Missing account ID')
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors with proper error mapping', async () => {
      const networkError = new Error('Network connection failed')
      // Intentionally `Once`: unlike verifyCredentials above, this doesn't
      // assert on the error message, so it still passes if retries fall
      // through to a real fetch() and surface a different error instead.
      fetchMock.mockRejectedValueOnce(networkError)

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle malformed API responses', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          jsonBody: { invalid: 'response' }, // Missing required fields
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle rate limiting with retry-after header', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [{ code: 10013, message: 'Rate limit exceeded' }],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValue(
        makeResponse({
          ok: false,
          status: 429,
          jsonBody: mockResponse,
          headers: { 'Retry-After': '120' },
        }),
      )

      await expect(client.listRulesets()).rejects.toThrow()
    })

    it('should handle partial API failures gracefully', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [
          { code: 81044, message: 'Ruleset not found' },
          { code: 81045, message: 'Rule limit exceeded' },
        ],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      await expect(client.listRulesets()).rejects.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty ruleset responses', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.listRulesets()
      expect(result).toEqual([])
    })

    it('should handle rulesets with complex rule structures', async () => {
      const complexRule: CloudflareRule = {
        id: 'complex-rule',
        action: 'challenge',
        expression: '(http.request.uri.path matches "^/api/.*") and (ip.geoip.country ne "US")',
        description: 'Challenge non-US API requests',
        enabled: true,
      }

      const mockRuleset: CloudflareRuleset = {
        id: 'complex-ruleset',
        name: 'Complex Ruleset',
        description: 'Ruleset with complex rules',
        kind: 'custom',
        phase: 'http_request_firewall_custom',
        version: '1',
        rules: [complexRule],
      }

      const mockResponse: CloudflareAPIResponse<CloudflareRuleset> = {
        success: true,
        errors: [],
        messages: [],
        result: mockRuleset,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.getRuleset('complex-ruleset')
      expect(result.rules[0]?.action).toBe('challenge')
      expect(result.rules[0]?.expression).toContain('matches')
    })

    it('should handle large list operations', async () => {
      const largeItemList: CloudflareListItem[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `item-${i}`,
        ip: `192.168.${Math.floor(i / 256)}.${i % 256}`,
        comment: `Test IP ${i}`,
        created_on: '2024-01-01T00:00:00Z',
        modified_on: '2024-01-01T00:00:00Z',
      }))

      const mockResponse = {
        success: true,
        errors: [],
        messages: [],
        result: largeItemList,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.getListItems('large-list')
      expect(result).toHaveLength(1000)
    })

    it('should handle concurrent API calls', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: true,
        errors: [],
        messages: [],
        result: [],
      }

      // Mock multiple concurrent calls
      fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const promises = Array.from({ length: 5 }, () => client.listRulesets())
      const results = await Promise.all(promises)

      expect(results).toHaveLength(5)
      // With request deduplication, concurrent identical requests share a single fetch call
      // The first call triggers the fetch, subsequent concurrent calls are deduplicated
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('Credential Validation Edge Cases', () => {
    it('should handle token with insufficient permissions', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [{ code: 10000, message: 'Insufficient permissions' }],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 403, jsonBody: mockResponse }))

      // verifyCredentials returns false for generic errors that don't match specific credential patterns
      await expect(client.verifyCredentials()).resolves.toBe(false)
    })

    it('should handle expired tokens', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareRuleset[]> = {
        success: false,
        errors: [{ code: 10000, message: 'Token expired' }],
        messages: [],
        result: [],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 401, jsonBody: mockResponse }))

      // verifyCredentials returns false for generic errors that don't match specific credential patterns
      await expect(client.verifyCredentials()).resolves.toBe(false)
    })

    it('should handle zone not found scenarios', async () => {
      const mockResponse: CloudflareAPIResponse<any> = {
        success: false,
        errors: [{ code: 1001, message: 'Zone not found' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 404, jsonBody: mockResponse }))

      await expect(client.getZoneInfo()).rejects.toThrow()
    })
  })

  describe('Lists API Edge Cases', () => {
    it('should handle Lists API quota exceeded', async () => {
      const mockResponse: CloudflareAPIResponse<CloudflareList> = {
        success: false,
        errors: [{ code: 10037, message: 'List quota exceeded' }],
        messages: [],
        result: {} as unknown as CloudflareList,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 400, jsonBody: mockResponse }))

      await expect(
        client.createList({
          name: 'Test List',
          description: 'Test',
          kind: 'ip',
        }),
      ).rejects.toThrow()
    })

    it('should handle duplicate list items', async () => {
      const duplicateItems = [
        { ip: '192.168.1.1', comment: 'Duplicate IP' },
        { ip: '192.168.1.1', comment: 'Same IP again' },
      ]

      const mockResponse = {
        success: true,
        errors: [],
        messages: ['Duplicate items were ignored'],
        result: [
          {
            id: 'item-1',
            ip: '192.168.1.1',
            comment: 'Duplicate IP',
            created_on: '2024-01-01T00:00:00Z',
            modified_on: '2024-01-01T00:00:00Z',
          },
        ],
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: mockResponse }))

      const result = await client.addListItems('test-list', { items: duplicateItems })
      expect(result).toHaveLength(1) // Only one item should be returned
    })

    it('should handle list item validation errors', async () => {
      const invalidItems = [{ ip: 'invalid-ip', comment: 'Bad IP format' }]

      const mockResponse = {
        success: false,
        errors: [{ code: 10038, message: 'Invalid IP address format' }],
        messages: [],
        result: null,
      }

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 400, jsonBody: mockResponse }))

      await expect(client.addListItems('test-list', { items: invalidItems })).rejects.toThrow()
    })
  })
})
