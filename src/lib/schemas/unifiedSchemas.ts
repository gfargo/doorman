import { z } from 'zod'
import type { UnifiedCondition, UnifiedAction, UnifiedRule, UnifiedIPRule, UnifiedConfig } from '../types/unified'
import {
  actionTypeSchema,
  operatorSchema,
  fieldTypeSchema,
  rateLimitSchema,
  redirectSchema,
  baseConfigSchema,
  providersConfigSchema,
  configMetadataSchema,
  idSchema,
  ipAddressSchema,
} from './commonSchemas'

/**
 * Unified (provider-agnostic) validation schemas
 */

// Unified condition schema
export const unifiedConditionSchema = z
  .object({
    field: fieldTypeSchema.or(z.string()), // Allow custom fields
    operator: operatorSchema,
    value: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]).optional(),
    negated: z.boolean().optional(),
    key: z.string().optional(), // For header, query, cookie
  })
  .refine(
    // `exists`/`not_exists` (unified's equivalent of Vercel's `ex`/`nex` —
    // see providers/vercel/translator.ts's operator map) carry no value by
    // design, per #85. ruleConditionSchema (firewallSchemas.ts) already
    // gets this right; this schema never did, so a real rule translated
    // from a valid native config (any `ex`/`nex` condition) failed
    // status/diff/backup even though `doorman validate` accepted it. #213.
    (condition) =>
      condition.operator === 'exists' || condition.operator === 'not_exists' || condition.value !== undefined,
    { message: 'value is required unless operator is "exists" or "not_exists"', path: ['value'] },
  ) satisfies z.ZodType<UnifiedCondition>

// Unified action schema
export const unifiedActionSchema = z.object({
  type: actionTypeSchema,
  rateLimit: rateLimitSchema.optional(),
  redirect: redirectSchema.optional(),
  response: z
    .object({
      statusCode: z.number().int().min(100).max(599).optional(),
      content: z.string().optional(),
      contentType: z.string().optional(),
    })
    .optional(),
  duration: z.string().optional(),
}) satisfies z.ZodType<UnifiedAction>

// Unified rule schema
export const unifiedRuleSchema = z.object({
  id: idSchema,
  name: z.string().min(1, 'Rule name is required'),
  description: z.string().optional(),
  enabled: z.boolean(),
  conditions: z.array(unifiedConditionSchema).min(1, 'At least one condition is required'),
  conditionLogic: z.enum(['AND', 'OR']).optional().default('AND'),
  action: unifiedActionSchema,
  priority: z
    .number()
    .int()
    .optional()
    .describe(
      'Rule evaluation order. Lower numbers are evaluated first. Rules without a priority keep their config order ' +
        'and run after all prioritised rules. Fully honoured on Cloudflare; best-effort on Vercel, which cannot ' +
        'reposition rules that already exist remotely.',
    ),
  categories: z.array(z.string()).optional(),
}) satisfies z.ZodType<UnifiedRule>

// Unified IP rule schema
export const unifiedIPRuleSchema = z.object({
  id: idSchema,
  ip: ipAddressSchema,
  hostname: z.string().optional(),
  notes: z.string().optional(),
  action: z.enum(['deny', 'allow']),
}) satisfies z.ZodType<UnifiedIPRule>

// Unified config schema
export const unifiedConfigSchema = baseConfigSchema.extend({
  providers: providersConfigSchema.optional(),
  rules: z.array(unifiedRuleSchema),
  ips: z.array(unifiedIPRuleSchema).optional(),
  metadata: configMetadataSchema.optional(),
}) satisfies z.ZodType<UnifiedConfig>

// Config validation with provider check
export const validateUnifiedConfig = (config: unknown): UnifiedConfig => {
  const result = unifiedConfigSchema.safeParse(config)

  if (!result.success) {
    throw new Error(`Invalid unified configuration: ${result.error.message}`)
  }

  // Additional validation: if provider is specified, ensure provider config exists
  if (result.data.provider) {
    const providerConfig = result.data.providers?.[result.data.provider]
    if (!providerConfig) {
      throw new Error(`Provider '${result.data.provider}' specified but no configuration found in providers section`)
    }
  }

  return result.data
}
