import chalk from 'chalk'
import type { ErrorCode } from './ErrorCodes'

/**
 * Details object for additional error context
 */
export interface ErrorDetails {
  [key: string]: unknown
}

/**
 * Options for creating a DoormanError
 */
export interface DoormanErrorOptions {
  code: ErrorCode
  message: string
  suggestion?: string
  details?: ErrorDetails
  docsUrl?: string
  cause?: Error
}

/**
 * Custom error class for Doorman with structured error codes,
 * suggestions, and formatting capabilities
 */
export class DoormanError extends Error {
  public readonly code: ErrorCode
  public readonly suggestion?: string
  public readonly details?: ErrorDetails
  public readonly docsUrl?: string
  public override readonly cause?: Error

  constructor(options: DoormanErrorOptions) {
    super(options.message)
    this.name = 'DoormanError'
    this.code = options.code
    this.suggestion = options.suggestion
    this.details = options.details
    this.docsUrl = options.docsUrl
    this.cause = options.cause

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DoormanError)
    }
  }

  /**
   * Format the error with colors and structure for CLI output
   */
  format(): string {
    const parts: string[] = []

    // Error header with code and message
    parts.push(chalk.red.bold(`[${this.code}] ${this.message}`))
    parts.push('')

    // Suggestion if available
    if (this.suggestion) {
      parts.push(chalk.yellow.bold('Suggestion:'))
      parts.push(`  ${this.suggestion}`)
      parts.push('')
    }

    // Details if available
    if (this.details && Object.keys(this.details).length > 0) {
      parts.push(chalk.dim('Details:'))
      Object.entries(this.details).forEach(([key, value]) => {
        const formattedValue =
          typeof value === 'object' ? JSON.stringify(value, null, 2).split('\n').join('\n    ') : value
        parts.push(`  ${chalk.cyan(key)}: ${formattedValue}`)
      })
      parts.push('')
    }

    // Cause if available
    if (this.cause) {
      parts.push(chalk.dim('Caused by:'))
      parts.push(`  ${this.cause.message}`)
      parts.push('')
    }

    // Documentation URL
    if (this.docsUrl) {
      parts.push(chalk.cyan.bold('Documentation:'))
      parts.push(`  ${this.docsUrl}`)
      parts.push('')
    }

    return parts.join('\n')
  }

  /**
   * Format as plain text without colors (for logging, testing, etc.)
   */
  toPlainText(): string {
    const parts: string[] = []

    parts.push(`[${this.code}] ${this.message}`)

    if (this.suggestion) {
      parts.push(`Suggestion: ${this.suggestion}`)
    }

    if (this.details && Object.keys(this.details).length > 0) {
      parts.push('Details:')
      Object.entries(this.details).forEach(([key, value]) => {
        parts.push(`  ${key}: ${value}`)
      })
    }

    if (this.cause) {
      parts.push(`Caused by: ${this.cause.message}`)
    }

    if (this.docsUrl) {
      parts.push(`Documentation: ${this.docsUrl}`)
    }

    return parts.join('\n')
  }

  /**
   * Check if an error is a DoormanError
   */
  static isDoormanError(error: unknown): error is DoormanError {
    return error instanceof DoormanError
  }

  /**
   * Convert any error to a DoormanError
   * If already a DoormanError, returns as-is
   * Otherwise wraps in a generic DoormanError
   */
  static from(error: unknown, code: ErrorCode, message?: string): DoormanError {
    if (DoormanError.isDoormanError(error)) {
      return error
    }

    if (error instanceof Error) {
      return new DoormanError({
        code,
        message: message || error.message,
        cause: error,
      })
    }

    return new DoormanError({
      code,
      message: message || String(error),
    })
  }
}
