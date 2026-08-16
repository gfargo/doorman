/**
 * Error codes for Doorman
 * Organized by category for better error tracking and debugging
 */

/**
 * Configuration errors (1000-1999)
 */
export enum ConfigErrorCode {
  INVALID = 'CONFIG_1000',
  NOT_FOUND = 'CONFIG_1001',
  PARSE_ERROR = 'CONFIG_1002',
  INVALID_VERSION = 'CONFIG_1003',
  MIGRATION_FAILED = 'CONFIG_1004',
  INVALID_PROVIDER = 'CONFIG_1005',
}

/**
 * Validation errors (2000-2999)
 */
export enum ValidationErrorCode {
  FAILED = 'VAL_2000',
  SCHEMA_ERROR = 'VAL_2001',
  RULE_ERROR = 'VAL_2002',
  IP_FORMAT = 'VAL_2003',
  RATE_LIMIT = 'VAL_2004',
  REDIRECT = 'VAL_2005',
}

/**
 * Sync errors (3000-3999)
 */
export enum SyncErrorCode {
  FAILED = 'SYNC_3000',
  RATE_LIMIT = 'SYNC_3001',
  CONFLICT = 'SYNC_3002',
  NO_CHANGES = 'SYNC_3003',
  PARTIAL_FAILURE = 'SYNC_3004',
}

/**
 * Migration errors (4000-4999)
 */
export enum MigrationErrorCode {
  FAILED = 'MIG_4000',
  INCOMPATIBLE = 'MIG_4001',
  ROLLBACK_FAILED = 'MIG_4002',
  MISSING_FEATURES = 'MIG_4003',
}

/**
 * Provider errors (5000-5999)
 */
export enum ProviderErrorCode {
  AUTH_FAILED = 'PROV_5000',
  NOT_FOUND = 'PROV_5001',
  API_ERROR = 'PROV_5002',
  RATE_LIMIT = 'PROV_5003',
  INVALID_CREDENTIALS = 'PROV_5004',
  NETWORK_ERROR = 'PROV_5005',
  TIMEOUT = 'PROV_5006',
}

/**
 * Cloudflare-specific errors (6000-6999)
 */
export enum CloudflareErrorCode {
  // API and connectivity errors
  RULESET_NOT_FOUND = 'CF_6000',
  RULE_LIMIT_EXCEEDED = 'CF_6001',
  INVALID_EXPRESSION = 'CF_6002',
  LIST_NOT_FOUND = 'CF_6003',
  ACCOUNT_ID_REQUIRED = 'CF_6004',
  ZONE_ID_REQUIRED = 'CF_6005',
  INVALID_RULESET = 'CF_6006',
  RULE_NO_CONDITIONS = 'CF_6007',

  // Rate limiting errors
  INVALID_RATE_LIMIT = 'CF_6008',
  INVALID_WINDOW_FORMAT = 'CF_6009',
  SHORT_MITIGATION_TIMEOUT = 'CF_6010',

  // Redirect errors
  REDIRECT_NO_LOCATION = 'CF_6011',
  INVALID_REDIRECT_URL = 'CF_6012',

  // IP blocking errors
  INVALID_IP = 'CF_6013',
  LARGE_IP_LIST = 'CF_6014',

  // Configuration errors
  EMPTY_CHARACTERISTICS = 'CF_6015',
  INVALID_CREDENTIALS = 'CF_6016',
  INSUFFICIENT_PERMISSIONS = 'CF_6017',

  // Translation warnings
  TRANSLATION_WARNING = 'CF_6018',
  FEATURE_UNSUPPORTED = 'CF_6019',

  // Additional production readiness errors
  PLAN_LIMIT_EXCEEDED = 'CF_6020',
  ZONE_SUSPENDED = 'CF_6021',
  MAINTENANCE_MODE = 'CF_6022',
  QUOTA_EXCEEDED = 'CF_6023',
  INVALID_ZONE_SETTING = 'CF_6024',
}

/**
 * Vercel-specific errors (7000-7999)
 */
export enum VercelErrorCode {
  PROJECT_NOT_FOUND = 'VCL_7000',
  TEAM_NOT_FOUND = 'VCL_7001',
  RULE_LIMIT_EXCEEDED = 'VCL_7002',
  INVALID_RULE = 'VCL_7003',
}

/**
 * Network/HTTP errors (8000-8999)
 */
export enum NetworkErrorCode {
  TIMEOUT = 'NET_8000',
  CONNECTION_FAILED = 'NET_8001',
  DNS_ERROR = 'NET_8002',
  RATE_LIMITED = 'NET_8003',
  HTTP_ERROR = 'NET_8004',
}

/**
 * Translation errors (9000-9999)
 */
export enum TranslationErrorCode {
  FAILED = 'TRANS_9000',
  UNSUPPORTED_FEATURE = 'TRANS_9001',
  LOSSY_CONVERSION = 'TRANS_9002',
  EXPRESSION_PARSE_FAILED = 'TRANS_9003',
}

/**
 * Union type of all error codes
 */
export type ErrorCode =
  | ConfigErrorCode
  | ValidationErrorCode
  | SyncErrorCode
  | MigrationErrorCode
  | ProviderErrorCode
  | CloudflareErrorCode
  | VercelErrorCode
  | NetworkErrorCode
  | TranslationErrorCode
