import { logger } from '../logger'
import type { ProviderType } from './IFirewallProvider'

/**
 * HTTP request options
 */
export interface RequestOptions extends RequestInit {
  timeout?: number
  retries?: number
  retryDelay?: number
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  limit?: number
  remaining?: number
  reset?: number
}

/**
 * Abstract base class for firewall API clients
 * Provides common HTTP operations, error handling, retry logic, and rate limiting
 */
export abstract class BaseFirewallClient {
  protected readonly baseUrl: string
  protected readonly providerName: ProviderType
  private rateLimitInfo: RateLimitInfo = {}

  constructor(baseUrl: string, providerName: ProviderType) {
    this.baseUrl = baseUrl
    this.providerName = providerName
  }

  /**
   * Get authentication headers for API requests
   * Must be implemented by provider-specific clients
   */
  protected abstract getAuthHeaders(): Record<string, string>

  /**
   * Make an HTTP request with retry logic and rate limit handling
   * @param path - API endpoint path
   * @param options - Request options
   * @returns Promise resolving to the response data
   */
  protected async makeRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const { timeout = 30000, retries = 3, retryDelay = 1000, ...fetchOptions } = options

    let lastError: Error | null = null
    let controller: AbortController | null = null
    let timeoutId: NodeJS.Timeout | null = null

    // Cleanup function to prevent memory leaks
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (controller) {
        controller.abort()
        controller = null
      }
    }

    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          controller = new AbortController()
          timeoutId = setTimeout(() => {
            if (controller) {
              controller.abort()
            }
          }, timeout)

          const response = await fetch(url, {
            ...fetchOptions,
            headers: {
              'Content-Type': 'application/json',
              ...this.getAuthHeaders(),
              ...fetchOptions.headers,
            },
            signal: controller.signal,
          })

          // Clear timeout on successful response
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }

          // Update rate limit info
          this.updateRateLimitInfo(response)

          // Handle rate limiting with exponential backoff
          if (response.status === 429) {
            const waitTime = this.calculateRateLimitWait(attempt, response)

            // Retrying past the last attempt would just fall through to the
            // generic `lastError || new Error('Request failed after all
            // retries')` below, discarding the fact this was a rate-limit
            // exhaustion. Throw a real error with that context instead —
            // it flows through the same catch-block handling as any other
            // attempt (isNonRetryableError, last-attempt re-throw).
            if (attempt === retries) {
              throw new Error(
                `${this.providerName} API rate limit exceeded after ${retries + 1} attempt(s) (429 Too Many Requests). Retry after ~${Math.round(waitTime / 1000)}s.`,
              )
            }

            logger.warn(
              `Rate limit exceeded for ${this.providerName}. Waiting ${waitTime}ms before retry (attempt ${attempt + 1}/${retries + 1})...`,
            )
            await this.delay(waitTime)
            continue
          }

          // Handle other errors
          if (!response.ok) {
            const error = await this.handleErrorResponse(response)
            throw error
          }

          // Parse response with error handling
          let data: T
          try {
            const responseText = await response.text()
            if (!responseText.trim()) {
              // Handle empty responses
              data = {} as T
            } else {
              data = JSON.parse(responseText) as T
            }
          } catch (parseError) {
            logger.error(`Failed to parse response from ${url}:`, parseError)
            throw new Error(
              `Invalid JSON response from ${this.providerName} API: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            )
          }

          // Validate response structure for large responses to prevent memory issues
          if (this.isLargeResponse(data)) {
            logger.debug(`Large response detected from ${url}, validating structure...`)
            this.validateLargeResponse(data)
          }

          return data
        } catch (error) {
          lastError = error as Error

          // Clean up resources for this attempt
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }

          // Don't retry on certain errors
          if (this.isNonRetryableError(error)) {
            throw error
          }

          // Last attempt - throw error
          if (attempt === retries) {
            throw error
          }

          // Calculate exponential backoff delay with jitter
          const baseDelay = retryDelay * Math.pow(2, attempt)
          const jitter = Math.random() * 0.1 * baseDelay // Add up to 10% jitter
          const delay = Math.min(baseDelay + jitter, 30000) // Cap at 30 seconds

          logger.debug(`Request failed (attempt ${attempt + 1}/${retries + 1}). Retrying in ${Math.round(delay)}ms...`)
          logger.debug(`Error details: ${error instanceof Error ? error.message : String(error)}`)

          await this.delay(delay)
        }
      }

      throw lastError || new Error('Request failed after all retries')
    } finally {
      // Ensure cleanup happens even if an exception is thrown
      cleanup()
    }
  }

  /**
   * Make a GET request
   */
  protected async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>(path, { ...options, method: 'GET' })
  }

  /**
   * Make a POST request
   */
  protected async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>(path, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  /**
   * Make a PUT request
   */
  protected async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>(path, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  /**
   * Make a PATCH request
   */
  protected async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>(path, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  /**
   * Make a DELETE request
   */
  protected async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.makeRequest<T>(path, { ...options, method: 'DELETE' })
  }

  /**
   * Update rate limit information from response headers
   */
  private updateRateLimitInfo(response: Response): void {
    const limit = response.headers.get('X-RateLimit-Limit')
    const remaining = response.headers.get('X-RateLimit-Remaining')
    const reset = response.headers.get('X-RateLimit-Reset')

    if (limit) this.rateLimitInfo.limit = parseInt(limit, 10)
    if (remaining) this.rateLimitInfo.remaining = parseInt(remaining, 10)
    if (reset) this.rateLimitInfo.reset = parseInt(reset, 10)

    // Warn if approaching rate limit
    if (this.rateLimitInfo.remaining && this.rateLimitInfo.remaining < 10) {
      logger.warn(`Approaching rate limit for ${this.providerName}: ${this.rateLimitInfo.remaining} requests remaining`)
    }
  }

  /**
   * Calculate wait time for rate limit with exponential backoff.
   *
   * `Retry-After` (RFC 9110 §10.2.3) is the standard header servers use to
   * tell a client how long to wait after a 429/503 — Cloudflare's API sends
   * it — and takes priority over the non-standard `X-RateLimit-Reset` this
   * client also tracks, which not every provider even sends. Falls back to
   * exponential backoff only when the response gives no explicit guidance.
   */
  private calculateRateLimitWait(attempt: number = 0, response?: Response): number {
    const maxWait = 60000 // Cap at 1 minute

    const retryAfterMs = response ? this.parseRetryAfter(response.headers.get('Retry-After')) : null
    if (retryAfterMs !== null) {
      // Minimum 1 second, capped at 1 minute — same reasoning as the
      // X-RateLimit-Reset cap below: a far-future value shouldn't block the
      // command for its full duration on a single retry with no override.
      return Math.min(Math.max(retryAfterMs, 1000), maxWait)
    }

    if (this.rateLimitInfo.reset) {
      const now = Math.floor(Date.now() / 1000)
      const waitTime = (this.rateLimitInfo.reset - now) * 1000
      // A far-future X-RateLimit-Reset (e.g. an hour out) would otherwise
      // block the command for the full duration on a single retry with no
      // way to override — cap it the same way the exponential fallback below is.
      return Math.min(Math.max(waitTime, 1000), maxWait) // Minimum 1 second, capped at 1 minute
    }

    // Use exponential backoff for rate limits when reset time is not available
    const baseWait = 5000 // 5 seconds base
    const exponentialWait = baseWait * Math.pow(2, attempt)

    return Math.min(exponentialWait, maxWait)
  }

  /**
   * Parse a `Retry-After` header value into a millisecond delay from now.
   * Per RFC 9110 §10.2.3 the value is either an integer number of seconds,
   * or an HTTP-date. Returns `null` if the header is absent or unparseable.
   */
  private parseRetryAfter(value: string | null): number | null {
    if (!value) return null

    const seconds = Number(value)
    if (Number.isFinite(seconds)) {
      return seconds * 1000
    }

    const dateMs = Date.parse(value)
    if (!Number.isNaN(dateMs)) {
      return dateMs - Date.now()
    }

    return null
  }

  /**
   * Handle error response from API
   */
  private async handleErrorResponse(response: Response): Promise<Error> {
    const base = `${this.providerName} API error: ${response.status} ${response.statusText}`
    let errorMessage = base

    try {
      const errorData: unknown = await response.json()
      if (typeof errorData === 'object' && errorData !== null) {
        const data = errorData as Record<string, unknown>
        if (typeof data.error === 'string') {
          errorMessage = `${base} - ${data.error}`
        } else if (typeof data.message === 'string') {
          errorMessage = `${base} - ${data.message}`
        } else if (Array.isArray(data.errors)) {
          const messages = data.errors
            .map((e) => {
              if (typeof e === 'object' && e !== null && 'message' in (e as Record<string, unknown>)) {
                return String((e as Record<string, unknown>).message)
              }
              return JSON.stringify(e)
            })
            .join(', ')
          errorMessage = `${base} - ${messages}`
        }
      }
    } catch {
      // Unable to parse error response
    }

    logger.error(errorMessage)
    return new Error(errorMessage)
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryableError(error: unknown): boolean {
    // Don't retry on abort errors
    if (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError') {
      return true
    }

    // Don't retry on 4xx errors (except 429)
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.includes('API error: 4')) {
      return !message.includes('429')
    }

    return false
  }

  /**
   * Delay helper
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get current rate limit information
   */
  public getRateLimitInfo(): RateLimitInfo {
    return { ...this.rateLimitInfo }
  }

  /**
   * Check if response is large and might cause memory issues
   */
  private isLargeResponse(data: unknown): boolean {
    if (!data || typeof data !== 'object') {
      return false
    }

    // Check if response contains large arrays
    const checkObject = (obj: any, depth = 0): boolean => {
      if (depth > 10) return false // Prevent deep recursion

      for (const [, value] of Object.entries(obj)) {
        if (Array.isArray(value) && value.length > 1000) {
          return true
        }
        if (typeof value === 'object' && value !== null && checkObject(value, depth + 1)) {
          return true
        }
      }
      return false
    }

    return checkObject(data)
  }

  /**
   * Validate large responses to prevent memory issues
   */
  private validateLargeResponse(data: unknown): void {
    if (!data || typeof data !== 'object') {
      return
    }

    const validateArray = (arr: unknown[], path: string) => {
      if (arr.length > 5000) {
        logger.warn(`Large array detected at ${path} with ${arr.length} items. This may impact performance.`)
      }

      // Sample validate first few items to ensure structure consistency
      const sampleSize = Math.min(10, arr.length)
      const firstItem = arr[0]

      if (firstItem && typeof firstItem === 'object') {
        const expectedKeys = Object.keys(firstItem)

        for (let i = 1; i < sampleSize; i++) {
          const item = arr[i]
          if (!item || typeof item !== 'object') {
            logger.warn(`Inconsistent array structure at ${path}[${i}]: expected object, got ${typeof item}`)
            continue
          }

          const itemKeys = Object.keys(item)
          const missingKeys = expectedKeys.filter((key) => !itemKeys.includes(key))

          if (missingKeys.length > 0) {
            logger.warn(`Inconsistent array structure at ${path}[${i}]: missing keys ${missingKeys.join(', ')}`)
          }
        }
      }
    }

    const validateObject = (obj: unknown, path = 'root', depth = 0) => {
      if (depth > 10) return // Prevent deep recursion

      for (const [currentKey, value] of Object.entries(obj as Record<string, unknown>)) {
        const currentPath = `${path}.${currentKey}`

        if (Array.isArray(value)) {
          validateArray(value, currentPath)
        } else if (typeof value === 'object' && value !== null) {
          validateObject(value, currentPath, depth + 1)
        }
      }
    }

    validateObject(data)
  }
}
