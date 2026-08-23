import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudArmorClient } from '../CloudArmorClient'
import type { CloudArmorSecurityPolicy } from '../../../types/gcp'

// Mock logger
jest.mock('../../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// getClient().getRequestHeaders() returns a real WHATWG Headers instance in
// the real library (confirmed against google-auth-library's own source) —
// mocking it as a plain object here would silently hide the exact bug this
// suite exists to catch (spreading a Headers instance produces `{}`), so the
// mock deliberately returns a real `new Headers(...)`, not `{authorization: ...}`.
const getRequestHeaders = jest.fn<() => Promise<Headers>>()
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: jest.fn<() => Promise<{ getRequestHeaders: typeof getRequestHeaders }>>().mockResolvedValue({
      getRequestHeaders,
    }),
  })),
}))

// Helper to build Response-like objects
const makeResponse = (init: { ok: boolean; status: number; statusText?: string; jsonBody?: unknown }): Response => {
  const body = init.jsonBody
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText || '',
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

describe('CloudArmorClient', () => {
  let client: CloudArmorClient
  let fetchMock: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    client = new CloudArmorClient('test-project', 'test-policy')
    fetchMock = jest.spyOn(globalThis, 'fetch')
    jest.spyOn(CloudArmorClient.prototype as any, 'delay').mockResolvedValue(undefined)
    getRequestHeaders.mockResolvedValue(
      new Headers({ authorization: 'Bearer test-access-token', 'x-goog-user-project': 'test-project' }),
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getAuthHeaders', () => {
    it('sends the real Authorization header on every request (regression: getRequestHeaders() returns a Headers instance, and spreading one directly silently drops every header)', async () => {
      const policy: CloudArmorSecurityPolicy = { name: 'test-policy', rules: [] }
      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: policy }))

      await client.getPolicy()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
      const headers = requestInit.headers as Record<string, string>
      expect(headers['authorization']).toBe('Bearer test-access-token')
      expect(headers['x-goog-user-project']).toBe('test-project')
    })
  })
})
