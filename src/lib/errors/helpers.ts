import { DoormanError } from './DoormanError'
import {
    ConfigErrorCode,
    ValidationErrorCode,
    SyncErrorCode,
    ProviderErrorCode,
    CloudflareErrorCode,
    NetworkErrorCode,
    TranslationErrorCode,
} from './ErrorCodes'

const DOCS_BASE_URL = 'https://docs.doorman.griffen.codes/errors'

/**
 * Configuration error helpers
 */
export const configErrors = {
  notFound: (path: string) =>
    new DoormanError({
      code: ConfigErrorCode.NOT_FOUND,
      message: `Configuration file not found: ${path}`,
      suggestion: 'Run "doorman init" to create a new configuration file',
      details: { path },
      docsUrl: `${DOCS_BASE_URL}/${ConfigErrorCode.NOT_FOUND}`,
    }),

  parseError: (path: string, cause?: Error) =>
    new DoormanError({
      code: ConfigErrorCode.PARSE_ERROR,
      message: `Failed to parse configuration file: ${path}`,
      suggestion: 'Check that your configuration file is valid JSON',
      details: { path },
      cause,
      docsUrl: `${DOCS_BASE_URL}/${ConfigErrorCode.PARSE_ERROR}`,
    }),

  invalidVersion: (version: string, expected: string) =>
    new DoormanError({
      code: ConfigErrorCode.INVALID_VERSION,
      message: `Unsupported configuration version: ${version}`,
      suggestion: `Expected version ${expected}. Run migration to update your config`,
      details: { version, expected },
      docsUrl: `${DOCS_BASE_URL}/${ConfigErrorCode.INVALID_VERSION}`,
    }),

  invalidProvider: (provider: string, supported: string[]) =>
    new DoormanError({
      code: ConfigErrorCode.INVALID_PROVIDER,
      message: `Invalid provider: ${provider}`,
      suggestion: `Supported providers: ${supported.join(', ')}`,
      details: { provider, supported },
      docsUrl: `${DOCS_BASE_URL}/${ConfigErrorCode.INVALID_PROVIDER}`,
    }),
}

/**
 * Provider error helpers
 */
export const providerErrors = {
  authFailed: (provider: string, cause?: Error) =>
    new DoormanError({
      code: ProviderErrorCode.AUTH_FAILED,
      message: `Authentication failed for ${provider}`,
      suggestion: 'Check that your API credentials are valid and have the correct permissions',
      details: { provider },
      cause,
      docsUrl: `${DOCS_BASE_URL}/${ProviderErrorCode.AUTH_FAILED}`,
    }),

  apiError: (provider: string, endpoint: string, statusCode: number, message: string) =>
    new DoormanError({
      code: ProviderErrorCode.API_ERROR,
      message: `${provider} API error: ${statusCode} ${message}`,
      suggestion: 'Check the provider status page and your credentials',
      details: {
        provider,
        endpoint,
        statusCode,
        responseMessage: message,
      },
      docsUrl: `${DOCS_BASE_URL}/${ProviderErrorCode.API_ERROR}`,
    }),

  rateLimit: (provider: string, retryAfter?: number) =>
    new DoormanError({
      code: ProviderErrorCode.RATE_LIMIT,
      message: `Rate limit exceeded for ${provider}`,
      suggestion: retryAfter
        ? `Wait ${retryAfter} seconds and try again, or use --retry flag`
        : 'Wait a few minutes and try again, or use --retry flag',
      details: {
        provider,
        retryAfter,
      },
      docsUrl: `${DOCS_BASE_URL}/${ProviderErrorCode.RATE_LIMIT}`,
    }),

  timeout: (provider: string, operation: string) =>
    new DoormanError({
      code: ProviderErrorCode.TIMEOUT,
      message: `Request timeout for ${provider} ${operation}`,
      suggestion: 'Check your internet connection and try again',
      details: { provider, operation },
      docsUrl: `${DOCS_BASE_URL}/${ProviderErrorCode.TIMEOUT}`,
    }),

  invalidCredentials: (provider: string, missing: string[]) =>
    new DoormanError({
      code: ProviderErrorCode.INVALID_CREDENTIALS,
      message: `Missing or invalid credentials for ${provider}`,
      suggestion: `Please provide: ${missing.join(', ')}`,
      details: { provider, missing },
      docsUrl: `${DOCS_BASE_URL}/${ProviderErrorCode.INVALID_CREDENTIALS}`,
    }),
}

/**
 * Cloudflare-specific error helpers
 */
export const cloudflareErrors = {
  accountIdRequired: (operation: string) =>
    new DoormanError({
      code: CloudflareErrorCode.ACCOUNT_ID_REQUIRED,
      message: `Account ID required for ${operation}`,
      suggestion: 'Provide CLOUDFLARE_ACCOUNT_ID in your environment or configuration to use Lists API',
      details: { operation },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.ACCOUNT_ID_REQUIRED}`,
    }),

  zoneIdRequired: (operation: string) =>
    new DoormanError({
      code: CloudflareErrorCode.ZONE_ID_REQUIRED,
      message: `Zone ID required for ${operation}`,
      suggestion: 'Provide CLOUDFLARE_ZONE_ID in your environment or configuration',
      details: { operation },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.ZONE_ID_REQUIRED}`,
    }),

  invalidCredentials: (credentialType: string, details?: Record<string, unknown>) =>
    new DoormanError({
      code: CloudflareErrorCode.INVALID_CREDENTIALS,
      message: `Invalid Cloudflare ${credentialType}`,
      suggestion: 'Check your Cloudflare API credentials and ensure they have the correct permissions',
      details: { credentialType, ...details },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.INVALID_CREDENTIALS}`,
    }),

  insufficientPermissions: (operation: string, requiredPermissions: string[]) =>
    new DoormanError({
      code: CloudflareErrorCode.INSUFFICIENT_PERMISSIONS,
      message: `Insufficient permissions for ${operation}`,
      suggestion: `Ensure your API token has the following permissions: ${requiredPermissions.join(', ')}`,
      details: { operation, requiredPermissions },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.INSUFFICIENT_PERMISSIONS}`,
    }),

  ruleLimitExceeded: (count: number, limit: number) =>
    new DoormanError({
      code: CloudflareErrorCode.RULE_LIMIT_EXCEEDED,
      message: `Rule count (${count}) exceeds Cloudflare limit (${limit})`,
      suggestion: 'Consider consolidating rules, using Lists for IP blocking, or upgrading your Cloudflare plan',
      details: { count, limit },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.RULE_LIMIT_EXCEEDED}`,
    }),

  invalidExpression: (expression: string, reason: string) =>
    new DoormanError({
      code: CloudflareErrorCode.INVALID_EXPRESSION,
      message: `Invalid Cloudflare expression: ${reason}`,
      suggestion: 'Check Cloudflare Wirefilter expression syntax and field names',
      details: { expression, reason },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.INVALID_EXPRESSION}`,
    }),

  ruleNoConditions: (ruleName: string) =>
    new DoormanError({
      code: CloudflareErrorCode.RULE_NO_CONDITIONS,
      message: `Rule "${ruleName}" has no conditions`,
      suggestion: 'Add at least one condition to the rule or remove the empty rule',
      details: { ruleName },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.RULE_NO_CONDITIONS}`,
    }),

  invalidRateLimit: (ruleName: string, issue: string) =>
    new DoormanError({
      code: CloudflareErrorCode.INVALID_RATE_LIMIT,
      message: `Invalid rate limit configuration for rule "${ruleName}": ${issue}`,
      suggestion: 'Rate limit requests must be at least 1, and window format should be like "60s", "1h", "1d"',
      details: { ruleName, issue },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.INVALID_RATE_LIMIT}`,
    }),

  invalidWindowFormat: (window: string) =>
    new DoormanError({
      code: CloudflareErrorCode.INVALID_WINDOW_FORMAT,
      message: `Invalid rate limit window format: ${window}`,
      suggestion: 'Use format like "60s", "5m", "1h", or "1d"',
      details: { window },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.INVALID_WINDOW_FORMAT}`,
    }),

  shortMitigationTimeout: (timeout: number) =>
    new DoormanError({
      code: CloudflareErrorCode.SHORT_MITIGATION_TIMEOUT,
      message: `Mitigation timeout (${timeout}s) may be too short`,
      suggestion: 'Consider using at least 60 seconds for effective rate limiting',
      details: { timeout },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.SHORT_MITIGATION_TIMEOUT}`,
    }),

  redirectNoLocation: (ruleName: string) =>
    new DoormanError({
      code: CloudflareErrorCode.REDIRECT_NO_LOCATION,
      message: `Redirect rule "${ruleName}" is missing location URL`,
      suggestion: 'Add a redirect.location property with a valid URL or path',
      details: { ruleName },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.REDIRECT_NO_LOCATION}`,
    }),

  invalidRedirectUrl: (url: string) =>
    new DoormanError({
      code: CloudflareErrorCode.INVALID_REDIRECT_URL,
      message: `Invalid redirect URL: ${url}`,
      suggestion: 'Use a valid absolute URL (https://...) or relative path (/...)',
      details: { url },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.INVALID_REDIRECT_URL}`,
    }),

  invalidIP: (ip: string) =>
    new DoormanError({
      code: CloudflareErrorCode.INVALID_IP,
      message: `Invalid IP address format: ${ip}`,
      suggestion: 'Use valid IPv4 or IPv6 address with optional CIDR notation (e.g., 192.168.1.1 or 192.168.1.0/24)',
      details: { ip },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.INVALID_IP}`,
    }),

  largeIPList: (count: number) =>
    new DoormanError({
      code: CloudflareErrorCode.LARGE_IP_LIST,
      message: `Large IP list detected (${count} IPs)`,
      suggestion:
        'Consider providing CLOUDFLARE_ACCOUNT_ID to use Lists API for better performance with large IP lists',
      details: { count },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.LARGE_IP_LIST}`,
    }),

  rulesetNotFound: (rulesetId?: string) =>
    new DoormanError({
      code: CloudflareErrorCode.RULESET_NOT_FOUND,
      message: rulesetId ? `Ruleset not found: ${rulesetId}` : 'Ruleset not found',
      suggestion: 'The ruleset may have been deleted. Try running the command again to create a new one.',
      details: { rulesetId },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.RULESET_NOT_FOUND}`,
    }),

  listNotFound: (listId?: string) =>
    new DoormanError({
      code: CloudflareErrorCode.LIST_NOT_FOUND,
      message: listId ? `List not found: ${listId}` : 'List not found',
      suggestion: 'The IP list may have been deleted. Try running the command again to create a new one.',
      details: { listId },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.LIST_NOT_FOUND}`,
    }),

  emptyCharacteristics: (ruleName: string) =>
    new DoormanError({
      code: CloudflareErrorCode.EMPTY_CHARACTERISTICS,
      message: `Rate limit rule "${ruleName}" has empty characteristics`,
      suggestion: 'Add characteristics like ["ip.src"] or remove the characteristics array to use default',
      details: { ruleName },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.EMPTY_CHARACTERISTICS}`,
    }),

  translationWarning: (feature: string, limitation: string) =>
    new DoormanError({
      code: CloudflareErrorCode.TRANSLATION_WARNING,
      message: `Translation warning for feature "${feature}": ${limitation}`,
      suggestion: 'Review the translated configuration and adjust if necessary',
      details: { feature, limitation },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.TRANSLATION_WARNING}`,
    }),

  featureUnsupported: (feature: string, provider: string) =>
    new DoormanError({
      code: CloudflareErrorCode.FEATURE_UNSUPPORTED,
      message: `Feature "${feature}" is not supported when migrating from ${provider} to Cloudflare`,
      suggestion: 'Remove this feature or implement it using Cloudflare-specific alternatives',
      details: { feature, provider },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.FEATURE_UNSUPPORTED}`,
    }),

  planLimitExceeded: (resource: string, limit: number, current: number) =>
    new DoormanError({
      code: CloudflareErrorCode.PLAN_LIMIT_EXCEEDED,
      message: `${resource} limit exceeded: ${current}/${limit}`,
      suggestion: 'Consider upgrading your Cloudflare plan or reducing resource usage',
      details: { resource, limit, current },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.PLAN_LIMIT_EXCEEDED}`,
    }),

  zoneSuspended: (zoneId: string, reason?: string) =>
    new DoormanError({
      code: CloudflareErrorCode.ZONE_SUSPENDED,
      message: `Zone is suspended: ${zoneId}${reason ? ` (${reason})` : ''}`,
      suggestion: 'Contact Cloudflare support to resolve zone suspension issues',
      details: { zoneId, reason },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.ZONE_SUSPENDED}`,
    }),

  maintenanceMode: (service: string) =>
    new DoormanError({
      code: CloudflareErrorCode.MAINTENANCE_MODE,
      message: `Cloudflare ${service} is currently in maintenance mode`,
      suggestion: 'Wait for maintenance to complete and try again. Check Cloudflare status page for updates.',
      details: { service, statusPage: 'https://www.cloudflarestatus.com/' },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.MAINTENANCE_MODE}`,
    }),

  quotaExceeded: (quotaType: string, resetTime?: string) =>
    new DoormanError({
      code: CloudflareErrorCode.QUOTA_EXCEEDED,
      message: `${quotaType} quota exceeded`,
      suggestion: resetTime
        ? `Wait until ${resetTime} for quota reset, or upgrade your plan for higher limits`
        : 'Wait for quota reset or upgrade your plan for higher limits',
      details: { quotaType, resetTime },
      docsUrl: `${DOCS_BASE_URL}/${CloudflareErrorCode.QUOTA_EXCEEDED}`,
    }),

  listsAPIUnavailable: (reason: string, fallbackAction: string) =>
    new DoormanError({
      code: CloudflareErrorCode.ACCOUNT_ID_REQUIRED,
      message: `Lists API unavailable: ${reason}`,
      suggestion: `Falling back to ${fallbackAction}. To enable Lists API, provide CLOUDFLARE_ACCOUNT_ID and ensure your API token has Account:Read permissions.`,
      details: { reason, fallbackAction, severity: 'warning' },
      docsUrl: `${DOCS_BASE_URL}/setup#account-id`,
    }),

  performanceWarning: (operation: string, count: number, impact: string) =>
    new DoormanError({
      code: CloudflareErrorCode.LARGE_IP_LIST,
      message: `Performance warning: ${operation} with ${count} items`,
      suggestion: `${impact} Consider providing CLOUDFLARE_ACCOUNT_ID to use Lists API for better performance.`,
      details: { operation, count, impact, severity: 'warning' },
      docsUrl: `${DOCS_BASE_URL}/performance#large-ip-lists`,
    }),
}

/**
 * Sync error helpers
 */
export const syncErrors = {
  failed: (provider: string, cause?: Error) =>
    new DoormanError({
      code: SyncErrorCode.FAILED,
      message: `Failed to sync firewall rules to ${provider}`,
      suggestion: 'Check your credentials and network connection',
      details: { provider },
      cause,
      docsUrl: `${DOCS_BASE_URL}/${SyncErrorCode.FAILED}`,
    }),

  noChanges: () =>
    new DoormanError({
      code: SyncErrorCode.NO_CHANGES,
      message: 'No changes detected between local and remote configuration',
      suggestion: 'Your local configuration matches the remote state',
    }),

  partialFailure: (provider: string, successful: number, failed: number) =>
    new DoormanError({
      code: SyncErrorCode.PARTIAL_FAILURE,
      message: `Partial sync failure for ${provider}: ${successful} succeeded, ${failed} failed`,
      suggestion: 'Review the detailed error messages and retry failed operations',
      details: { provider, successful, failed },
      docsUrl: `${DOCS_BASE_URL}/${SyncErrorCode.PARTIAL_FAILURE}`,
    }),
}

/**
 * Validation error helpers
 */
export const validationErrors = {
  failed: (errorCount: number) =>
    new DoormanError({
      code: ValidationErrorCode.FAILED,
      message: `Configuration validation failed with ${errorCount} error(s)`,
      suggestion: 'Fix the validation errors and try again',
      details: { errorCount },
      docsUrl: `${DOCS_BASE_URL}/${ValidationErrorCode.FAILED}`,
    }),

  schemaError: (path: string, expected: string, actual: string) =>
    new DoormanError({
      code: ValidationErrorCode.SCHEMA_ERROR,
      message: `Schema validation error at ${path}`,
      suggestion: `Expected ${expected}, got ${actual}`,
      details: { path, expected, actual },
      docsUrl: `${DOCS_BASE_URL}/${ValidationErrorCode.SCHEMA_ERROR}`,
    }),
}

/**
 * Translation error helpers
 */
export const translationErrors = {
  unsupportedFeature: (feature: string, sourceProvider: string, targetProvider: string) =>
    new DoormanError({
      code: TranslationErrorCode.UNSUPPORTED_FEATURE,
      message: `Feature "${feature}" is not supported when translating from ${sourceProvider} to ${targetProvider}`,
      suggestion: 'Remove this feature or use a different provider',
      details: { feature, sourceProvider, targetProvider },
      docsUrl: `${DOCS_BASE_URL}/${TranslationErrorCode.UNSUPPORTED_FEATURE}`,
    }),

  expressionParseFailed: (expression: string, cause?: Error) =>
    new DoormanError({
      code: TranslationErrorCode.EXPRESSION_PARSE_FAILED,
      message: `Failed to parse expression: ${expression}`,
      suggestion: 'Check expression syntax and field names',
      details: { expression },
      cause,
      docsUrl: `${DOCS_BASE_URL}/${TranslationErrorCode.EXPRESSION_PARSE_FAILED}`,
    }),
}

/**
 * Network error helpers
 */
export const networkErrors = {
  timeout: (url: string, timeoutMs: number) =>
    new DoormanError({
      code: NetworkErrorCode.TIMEOUT,
      message: `Request timed out after ${timeoutMs}ms`,
      suggestion: 'Check your internet connection and try again',
      details: { url, timeoutMs },
      docsUrl: `${DOCS_BASE_URL}/${NetworkErrorCode.TIMEOUT}`,
    }),

  connectionFailed: (url: string, cause?: Error) =>
    new DoormanError({
      code: NetworkErrorCode.CONNECTION_FAILED,
      message: `Failed to connect to ${url}`,
      suggestion: 'Check your internet connection and firewall settings',
      details: { url },
      cause,
      docsUrl: `${DOCS_BASE_URL}/${NetworkErrorCode.CONNECTION_FAILED}`,
    }),
}
