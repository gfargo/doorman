import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { CloudArmorClient } from '../CloudArmorClient'
import type { CloudArmorOperation, CloudArmorSecurityPolicy } from '../../../types/gcp'

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
  let delaySpy: jest.SpiedFunction<(ms: number) => Promise<void>>

  beforeEach(() => {
    client = new CloudArmorClient('test-project', 'test-policy')
    fetchMock = jest.spyOn(globalThis, 'fetch')
    delaySpy = jest.spyOn(CloudArmorClient.prototype as any, 'delay').mockResolvedValue(undefined) as any
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

  describe('waitForOperation poll cadence (#251)', () => {
    const operation = (status: CloudArmorOperation['status']): CloudArmorOperation => ({
      name: 'operation-1',
      status,
    })

    it('polls with a short initial interval, doubling toward the 1000ms ceiling, not a fixed 1000ms every time', async () => {
      fetchMock
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: operation('RUNNING') })) // POST addRule
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: operation('RUNNING') })) // poll 1
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: operation('RUNNING') })) // poll 2
        .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: operation('DONE') })) // poll 3

      await client.addRule({
        priority: 1000,
        match: { expr: { expression: "origin.ip == '1.2.3.4'" } },
        action: 'deny(403)',
      })

      expect(delaySpy).toHaveBeenCalledTimes(3)
      const delays = delaySpy.mock.calls.map((call) => call[0] as number)
      // Each interval is base * [1, 1.1) (jitter is additive, up to 10%),
      // and strictly increases toward (never past) the 1000ms ceiling.
      expect(delays[0]).toBeGreaterThanOrEqual(250)
      expect(delays[0]).toBeLessThan(275)
      expect(delays[1]).toBeGreaterThanOrEqual(500)
      expect(delays[1]).toBeLessThan(550)
      expect(delays[2]).toBeGreaterThanOrEqual(1000)
      expect(delays[2]).toBeLessThan(1100)
    })

    it('never sleeps longer than the old fixed 1000ms interval, even once fully backed off', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: operation('RUNNING') }))
      for (let i = 0; i < 5; i++) {
        fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: operation('RUNNING') }))
      }
      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: operation('DONE') }))

      await client.addRule({
        priority: 1000,
        match: { expr: { expression: "origin.ip == '1.2.3.4'" } },
        action: 'deny(403)',
      })

      const delays = delaySpy.mock.calls.map((call) => call[0] as number)
      delays.forEach((d) => expect(d).toBeLessThan(1100)) // 1000ms ceiling + up to 10% jitter
    })
  })
})
