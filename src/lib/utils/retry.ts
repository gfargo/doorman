import { logger } from '../logger'

export interface RetryOptions {
  maxAttempts?: number
  delayMs?: number
  backoff?: boolean
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = true } = options

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === maxAttempts) {
        break
      }

      const delay = backoff ? delayMs * attempt : delayMs
      logger.debug(`Retry attempt ${attempt}/${maxAttempts} failed. Retrying in ${delay}ms...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  logger.debug(`Operation failed after ${maxAttempts} attempts.`)
  // Re-throw the original error rather than wrapping it in a generic Error —
  // handleCommandError branches on `instanceof ZodError` and
  // `error.name === 'ValidationError'`, which would be unreachable if the
  // error's type/stack/code were discarded here.
  throw lastError ?? new Error(`Operation failed after ${maxAttempts} attempts`)
}
