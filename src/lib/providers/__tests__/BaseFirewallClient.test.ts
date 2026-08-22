import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { BaseFirewallClient, type RequestOptions } from '../BaseFirewallClient'

// Minimal test client that avoids real waiting and adds auth headers
class TestClient extends BaseFirewallClient {
  constructor(baseUrl = 'https://api.example.com') {
    super(baseUrl, 'vercel')
  }
  protected async getAuthHeaders(): Promise<Record<string, string>> {
    return { Authorization: 'Bearer TEST' }
  }
  // Avoid real delays during tests
  protected override delay(): Promise<void> {
    return Promise.resolve()
  }
  public async getJson<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.get<T>(path, options)
  }
  public async postJson<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.post<T>(path, body, options)
  }
}

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

describe('BaseFirewallClient', () => {
  const client = new TestClient()

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('performs GET and returns JSON on success', async () => {
    const data = { hello: 'world' }
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: data }))

    const result = await client.getJson('/test')
    expect(result).toEqual(data)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/test')
  })

  it('retries on 429 and succeeds on next attempt', async () => {
    const now = Math.floor(Date.now() / 1000)
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          jsonBody: { message: 'Rate limit' },
          headers: { 'X-RateLimit-Reset': String(now + 1) },
        }),
      )
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: { ok: true } }))

    const result = await client.getJson('/retry', { retries: 1, retryDelay: 1 })
    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caps the rate-limit wait at 1 minute even when X-RateLimit-Reset is an hour out (regression test for #96)', async () => {
    const delaySpy = jest.spyOn(client as unknown as { delay: (ms: number) => Promise<void> }, 'delay')
    const now = Math.floor(Date.now() / 1000)
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          jsonBody: { message: 'Rate limit' },
          headers: { 'X-RateLimit-Reset': String(now + 3600) }, // an hour out
        }),
      )
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: { ok: true } }))

    await client.getJson('/retry-far-future', { retries: 1, retryDelay: 1 })

    expect(delaySpy).toHaveBeenCalledWith(60000)
  })

  // Regression test: Retry-After (RFC 9110) is the standard header servers
  // use on 429s — Cloudflare sends it — and previously wasn't read at all,
  // only the non-standard X-RateLimit-Reset was. Must take priority.
  it('honors Retry-After over X-RateLimit-Reset when both are present', async () => {
    const delaySpy = jest.spyOn(client as unknown as { delay: (ms: number) => Promise<void> }, 'delay')
    const now = Math.floor(Date.now() / 1000)
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          jsonBody: { message: 'Rate limit' },
          headers: {
            'Retry-After': '5',
            'X-RateLimit-Reset': String(now + 3600), // would otherwise dominate and wait ~1hr (capped to 60s)
          },
        }),
      )
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: { ok: true } }))

    await client.getJson('/retry-after', { retries: 1, retryDelay: 1 })

    expect(delaySpy).toHaveBeenCalledWith(5000)
  })

  it('parses a Retry-After HTTP-date as well as a delay-in-seconds', async () => {
    const delaySpy = jest.spyOn(client as unknown as { delay: (ms: number) => Promise<void> }, 'delay')
    const retryAt = new Date(Date.now() + 10000)
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          jsonBody: { message: 'Rate limit' },
          headers: { 'Retry-After': retryAt.toUTCString() },
        }),
      )
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: { ok: true } }))

    await client.getJson('/retry-after-date', { retries: 1, retryDelay: 1 })

    // Allow a little slack for time elapsed during the test itself.
    const waitMs = delaySpy.mock.calls[0]?.[0] as number
    expect(waitMs).toBeGreaterThan(8000)
    expect(waitMs).toBeLessThanOrEqual(10000)
  })

  // Regression test: exhausting retries while still getting 429s previously
  // fell through to a generic "Request failed after all retries" error,
  // losing all rate-limit context.
  it('throws a rate-limit-specific error when retries are exhausted while still getting 429', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        jsonBody: { message: 'Rate limit' },
        headers: { 'Retry-After': '1' },
      }),
    )

    await expect(client.getJson('/exhausted', { retries: 1, retryDelay: 1 })).rejects.toThrow(
      /rate limit exceeded after 2 attempt/i,
    )
  })

  it('does not retry on 400 and throws formatted error', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({ ok: false, status: 400, statusText: 'Bad Request', jsonBody: { message: 'bad' } }),
      )

    await expect(client.getJson('/bad', { retries: 2 })).rejects.toThrow(/API error: 400/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats AbortError as non-retryable and throws', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError)

    await expect(client.getJson('/timeout', { retries: 3, timeout: 10 })).rejects.toThrow(/aborted/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('formats error messages from errors array', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeResponse({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        jsonBody: { errors: [{ message: 'foo' }, { bar: 1 }] },
      }),
    )

    await expect(client.getJson('/server', { retries: 0 })).rejects.toThrow(/foo/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('merges headers including auth and custom ones', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, jsonBody: { ok: true } }))
    await client.postJson('/path', { a: 1 }, { headers: { 'X-Custom': '1' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    const headers = (init.headers ?? {}) as Record<string, string>
    // Headers can be a plain object; verify key pieces
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Authorization']).toBe('Bearer TEST')
    expect(headers['X-Custom']).toBe('1')
  })
})
