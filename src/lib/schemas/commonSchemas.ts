import { z } from 'zod'
import type { ActionType, Operator, FieldType, ConfigMetadata, ProvidersConfig } from '../types/common'
import { PROVIDER_TYPES } from '../providers/IFirewallProvider'

/**
 * Common validation schemas shared across all providers
 */

// Basic schemas
export const idSchema = z.string().optional()

export const ipAddressSchema = z
  .string()
  .ip()
  .or(z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/)) // CIDR notation

export const timestampSchema = z.string().datetime().or(z.string().optional())

// Action type schema
export const actionTypeSchema = z.enum([
  'log',
  'deny',
  'challenge',
  'bypass',
  'rate_limit',
  'redirect',
  'allow',
  'block',
]) satisfies z.ZodType<ActionType>

// Operator schema
export const operatorSchema = z.enum([
  'eq',
  'ne',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches',
  'in',
  'not_in',
  'gt',
  'ge',
  'lt',
  'le',
  'exists',
  'not_exists',
]) satisfies z.ZodType<Operator>

// Field type schema
export const fieldTypeSchema = z.enum([
  'ip',
  'country',
  'region',
  'city',
  'asn',
  'path',
  'host',
  'method',
  'header',
  'query',
  'cookie',
  'user_agent',
  'referer',
  'scheme',
  'port',
]) satisfies z.ZodType<FieldType>

// Duration regex
export const durationSchema = z.string().regex(/^\d+[smhd]$|^permanent$/)

// Rate limit schema
export const rateLimitSchema = z.object({
  requests: z.number().positive().int(),
  window: z.string().regex(/^\d+[smhd]$/),
  characteristics: z.array(z.string()).optional(),
})

// Redirect schema
export const redirectSchema = z.object({
  location: z.string().url(),
  statusCode: z.number().int().min(300).max(399).optional(),
  permanent: z.boolean().optional(),
  preserveQueryString: z.boolean().optional(),
})

// Config metadata schema
export const configMetadataSchema = z.object({
  version: z.number().int().positive().optional(),
  updatedAt: timestampSchema,
  createdAt: timestampSchema,
  lastSyncedAt: timestampSchema,
  migratedFrom: z.string().optional(),
  migratedAt: timestampSchema,
}) satisfies z.ZodType<ConfigMetadata>

// Provider type schema. Derived from `PROVIDER_TYPES` rather than a
// hardcoded literal list — a config's `provider` field being validated
// against a schema that silently doesn't know about a new provider is
// exactly the class of bug this once caused (a `provider: 'fastly'` config
// would otherwise fail schema validation for a provider that's fully
// registered everywhere else).
export const providerTypeSchema = z.enum(PROVIDER_TYPES)

// Providers config schema
export const providersConfigSchema = z.object({
  vercel: z
    .object({
      projectId: z.string().optional(),
      teamId: z.string().optional(),
    })
    .optional(),
  cloudflare: z
    .object({
      zoneId: z.string().optional(),
      accountId: z.string().optional(),
    })
    .optional(),
  fastly: z
    .object({
      workspaceId: z.string().optional(),
    })
    .optional(),
}) satisfies z.ZodType<ProvidersConfig>

// Base config schema
export const baseConfigSchema = z.object({
  $schema: z.string().url().optional(),
  version: z.string().optional(),
  provider: providerTypeSchema.optional(),
  metadata: configMetadataSchema.optional(),
})
