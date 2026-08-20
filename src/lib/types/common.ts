/**
 * Common types shared across all firewall providers
 */

import type { ProviderType } from '../providers/IFirewallProvider'

/**
 * Action types supported across providers
 */
export type ActionType = 'log' | 'deny' | 'challenge' | 'bypass' | 'rate_limit' | 'redirect' | 'allow' | 'block'

/**
 * Common operators used in rule conditions
 */
export type Operator =
  | 'eq' // Equals
  | 'ne' // Not equals
  | 'contains' // Contains substring
  | 'not_contains' // Does not contain
  | 'starts_with' // Starts with (prefix)
  | 'ends_with' // Ends with (suffix)
  | 'matches' // Regex match
  | 'in' // Is any of (list)
  | 'not_in' // Is not any of
  | 'gt' // Greater than
  | 'ge' // Greater than or equal
  | 'lt' // Less than
  | 'le' // Less than or equal
  | 'exists' // Field exists
  | 'not_exists' // Field does not exist

/**
 * Common field types for conditions
 */
export type FieldType =
  | 'ip' // IP address
  | 'country' // Country code
  | 'region' // Geographic region
  | 'city' // City
  | 'asn' // AS number
  | 'path' // URL path
  | 'host' // Hostname
  | 'method' // HTTP method
  | 'header' // HTTP header
  | 'query' // Query parameter
  | 'cookie' // Cookie
  | 'user_agent' // User agent
  | 'referer' // Referer header
  | 'scheme' // Protocol scheme (http/https)
  | 'port' // Port number

/**
 * Configuration metadata
 */
export interface ConfigMetadata {
  version?: number
  updatedAt?: string
  createdAt?: string
  lastSyncedAt?: string
  migratedFrom?: string
  migratedAt?: string
}

/**
 * Provider-specific configuration section
 */
export interface ProviderConfig {
  [key: string]: unknown
}

/**
 * Credentials interface for provider authentication
 */
export interface Credentials {
  [key: string]: string | undefined
}

/**
 * Rate limit configuration
 */
export interface RateLimit {
  requests: number
  window: string // e.g., "60s", "1m", "1h", "1d"
  characteristics?: string[] // e.g., ["ip.src", "http.host"]
}

/**
 * Redirect configuration
 */
export interface Redirect {
  location: string
  permanent?: boolean
  statusCode?: number
  preserveQueryString?: boolean
}

/**
 * Base configuration interface
 */
export interface BaseConfig {
  $schema?: string
  version?: string
  provider?: ProviderType
  metadata?: ConfigMetadata
}

/**
 * Multi-provider configuration section
 */
export interface ProvidersConfig {
  vercel?: {
    projectId?: string
    teamId?: string
  }
  cloudflare?: {
    zoneId?: string
    accountId?: string
  }
  fastly?: {
    workspaceId?: string
  }
}
