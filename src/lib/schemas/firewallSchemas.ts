import { z } from 'zod'
import type {
  ActionType,
  ConditionGroup,
  CustomRule,
  FirewallConfig,
  IPBlockingRule,
  MitigationAction,
  ProjectConfig,
  RateLimit,
  Redirect,
  RuleAction,
  RuleCondition,
  RuleOperator,
  RuleType,
} from '../types'

// Basic schemas
export const configVersionSchema = z.number().int().positive().optional()

export const ipAddressSchema = z
  .string()
  .ip()
  .or(z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/)) // CIDR notation

export const idSchema = z.string().optional()

// Rule Types and Operators (from vercelTypes.ts)
export const ruleOperatorSchema = z.enum([
  'eq',
  'pre',
  'suf',
  'inc',
  'sub',
  're',
  'ex',
  'nex',
]) satisfies z.ZodType<RuleOperator>

export const ruleTypeSchema = z.enum([
  'host',
  'path',
  'method',
  'header',
  'query',
  'cookie',
  'target_path',
  'ip_address',
  'region',
  'protocol',
  'scheme',
  'environment',
  'user_agent',
  'geo_continent',
  'geo_country',
  'geo_country_region',
  'geo_city',
  'geo_as_number',
  'ja4_digest',
  'ja3_digest',
  'rate_limit_api_id',
]) satisfies z.ZodType<RuleType>

// Condition schemas
export const ruleConditionSchema = z
  .object({
    op: ruleOperatorSchema,
    neg: z.boolean().optional(),
    type: ruleTypeSchema,
    value: z.union([z.string(), z.array(z.string()), z.array(z.number())]).optional(),
    key: z.string().optional(),
  })
  .refine((condition) => {
    // Validate operator based on type
    switch (condition.type) {
      case 'ip_address':
      case 'method':
      case 'environment':
      case 'protocol':
        // equals, not equals, is any of, is not any of
        return condition.op === 'eq' || condition.op === 'inc'
      default:
        return true
    }
  }, 'Invalid operator for the given condition type')
  .refine((condition) => {
    const typesThatRequireKeyField = ['header', 'cookie'] as RuleType[]
    if (typesThatRequireKeyField.includes(condition.type) && !condition.key) {
      return false
    }

    // 'exists' or 'not exists' operators don't include the 'value' field
    if (
      typesThatRequireKeyField.includes(condition.type) &&
      condition.op !== 'ex' &&
      condition.op !== 'nex' &&
      !condition.value
    ) {
      return false
    }

    return true
  }, 'Missing key from condition')
  .refine((condition) => {
    const operatorsThatDontSupportNeg = ['ex', 'nex'] as RuleOperator[]
    if (operatorsThatDontSupportNeg.includes(condition.op) && condition.neg) {
      return false
    }

    return true
  }, 'Negation is not supported for the given operator')
  .refine((condition) => {
    // anything with `inc` operator should have an array of values
    if (condition.op === 'inc' && !Array.isArray(condition.value)) {
      return false
    }

    return true
  }, 'When using `inc` operator, value must be an array') satisfies z.ZodType<RuleCondition>

export const conditionGroupSchema = z.object({
  conditions: z.array(ruleConditionSchema).min(1, 'Condition group must have at least one condition'),
}) satisfies z.ZodType<ConditionGroup>

// Action schemas
export const ruleDurationSchema = z.string().regex(/^\d+[smhd]$|^permanent$/)

// Define schemas in order of dependency
export const rateLimitSchema = z.object({
  requests: z
    .number()
    .positive()
    .int()
    .refine((val) => val > 0, 'requests must be positive'),
  window: z
    .string()
    .regex(/^\d+[smhd]$/)
    .refine((val) => parseInt(val) > 0, 'window duration must be positive'),
}) satisfies z.ZodType<RateLimit>

export const redirectSchema = z.object({
  location: z.string(),
  permanent: z.boolean().optional(),
}) satisfies z.ZodType<Redirect>

export const actionTypeSchema = z.enum([
  'log',
  'deny',
  'challenge',
  'bypass',
  'rate_limit',
  'redirect',
]) satisfies z.ZodType<ActionType>

export const mitigationActionSchema = z.object({
  action: actionTypeSchema,
  rateLimit: rateLimitSchema.nullable().optional(),
  redirect: redirectSchema.nullable().optional(),
  actionDuration: ruleDurationSchema.nullable().optional(),
}) satisfies z.ZodType<MitigationAction>

// Define vercelActionSchema before using it
const ruleActionSchema = z.object({
  mitigate: mitigationActionSchema,
}) satisfies z.ZodType<RuleAction>

// Rule schemas
export const firewallRuleSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().optional(),
  conditionGroup: z.array(conditionGroupSchema),
  action: ruleActionSchema,
  active: z.boolean(),
}) satisfies z.ZodType<CustomRule>

// Export action schema
export { ruleActionSchema }

export const ipBlockingRuleSchema = z.object({
  id: idSchema,
  ip: ipAddressSchema,
  // Optional: purely informational (references/rules.md), matching
  // unifiedIPRuleSchema and the documented behavior — Vercel's API doesn't
  // need it. See #219.
  hostname: z.string().optional(),
  notes: z.string().optional(),
  action: z.literal('deny'),
}) satisfies z.ZodType<IPBlockingRule>

export const projectConfigSchema = z.object({
  projectId: z.string().optional(),
  teamId: z.string().optional(),
}) satisfies z.ZodType<ProjectConfig>

export const firewallConfigSchema = projectConfigSchema.extend({
  rules: z.array(firewallRuleSchema),
  ips: z.array(ipBlockingRuleSchema).optional(),
  version: z.number().optional(),
  updatedAt: z.string().optional(),
}) satisfies z.ZodType<FirewallConfig>
