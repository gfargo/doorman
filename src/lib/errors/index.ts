/**
 * Centralized error handling system for Doorman
 *
 * This module provides:
 * - Structured error codes organized by category
 * - DoormanError class with formatting capabilities
 * - Helper functions for common error scenarios
 *
 * Usage:
 * ```typescript
 * import { DoormanError, cloudflareErrors } from './lib/errors'
 *
 * throw cloudflareErrors.accountIdRequired('IP Lists')
 * ```
 */

export { DoormanError, type DoormanErrorOptions, type ErrorDetails } from './DoormanError'
export {
  type ErrorCode,
  ConfigErrorCode,
  ValidationErrorCode,
  SyncErrorCode,
  MigrationErrorCode,
  ProviderErrorCode,
  CloudflareErrorCode,
  VercelErrorCode,
  NetworkErrorCode,
  TranslationErrorCode,
} from './ErrorCodes'
export {
  configErrors,
  providerErrors,
  cloudflareErrors,
  syncErrors,
  validationErrors,
  translationErrors,
  networkErrors,
} from './helpers'
