import type { ErrorObject } from 'ajv'
import Ajv, { Ajv as AjvType } from 'ajv'
import { z } from 'zod'
import { schema } from '../../constants/schema'
import { conditionGroupSchema, firewallConfigSchema, rateLimitSchema } from '../schemas/firewallSchemas'
import { validateUnifiedConfig } from '../schemas/unifiedSchemas'
import { FirewallConfig, hasProviderMetadata } from '../types'
import { ErrorFormatter } from '../utils/errorFormatter'

export class ValidationError extends Error {
  constructor(
    message: string,
    public ajvErrors: ErrorObject[] | null | undefined,
    public zodError?: z.ZodError,
    public customErrors: string[] = [],
  ) {
    super(message)
    this.name = 'ValidationError'
  }

  static formatErrors(
    ajvErrors: ErrorObject[] | null | undefined,
    zodError?: z.ZodError,
    customErrors: string[] = [],
  ): string {
    const errors: string[] = []

    if (ajvErrors?.length) {
      errors.push(...ajvErrors.map(ErrorFormatter.formatValidationError))
    }

    if (zodError) {
      errors.push(
        ...zodError.errors.map((err) => {
          const path = err.path.join('.')
          return `${path}: ${err.message}`
        }),
      )
    }

    if (customErrors.length) {
      errors.push(...customErrors)
    }

    return ErrorFormatter.wrapErrorBlock(errors)
  }

  getFormattedMessage(): string {
    return ValidationError.formatErrors(this.ajvErrors, this.zodError, this.customErrors)
  }
}

export class ValidationService {
  private static instance: ValidationService
  private ajv: AjvType
  private schema: object

  private constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
    })

    this.schema = schema
  }

  static getInstance(): ValidationService {
    if (!ValidationService.instance) {
      ValidationService.instance = new ValidationService()
    }

    return ValidationService.instance
  }

  validateConfig(config: unknown): asserts config is FirewallConfig {
    // Multi-provider (Unified) configs — e.g. Cloudflare — declare a top-level
    // `provider`/`providers` field and use a different rule shape (`conditions` +
    // `action.type` instead of `conditionGroup` + `action.mitigate`). The AJV/Zod
    // schemas below only understand the legacy Vercel-only shape, so route those
    // configs to the unified schema instead of rejecting them as invalid.
    if (hasProviderMetadata(config)) {
      try {
        validateUnifiedConfig(config)
        return
      } catch (error) {
        throw new ValidationError(
          'Invalid firewall configuration:\n' + (error instanceof Error ? error.message : String(error)),
          null,
        )
      }
    }

    // AJV Validation
    const validate = this.ajv.compile(this.schema)
    const ajvValid = validate(config)
    const ajvErrors = validate.errors

    // Zod Validation
    const zodResult = firewallConfigSchema.safeParse(config)
    let zodError: z.ZodError | undefined

    if (!zodResult.success) {
      zodError = zodResult.error
    }

    // Additional custom validations (only if basic validations pass)
    const customErrors: string[] = []
    if (ajvValid && zodResult.success) {
      try {
        this.validateRuleNames(config as FirewallConfig)
        this.validateRuleConditionGroup(config as FirewallConfig)
        this.validateRuleAction(config as FirewallConfig)
      } catch (error) {
        if (error instanceof ValidationError) {
          // Ensure the primary error message is captured in aggregation
          customErrors.push(error.message, ...(error.customErrors || []))
        } else {
          throw error
        }
      }

      // Additional Zod validations for each rule
      for (const rule of (config as FirewallConfig).rules) {
        // Validate rate limit if present
        if (rule.action.mitigate?.rateLimit) {
          const rateLimitResult = rateLimitSchema.safeParse(rule.action.mitigate.rateLimit)
          if (!rateLimitResult.success) {
            customErrors.push(...rateLimitResult.error.errors.map((err) => err.message))
          }
        }

        // Validate condition groups if present
        if (rule.conditionGroup) {
          for (const group of rule.conditionGroup) {
            const groupResult = conditionGroupSchema.safeParse(group)
            if (!groupResult.success) {
              customErrors.push(...groupResult.error.errors.map((err) => err.message))
            }
          }
        }
      }
    }

    // If any validation failed, throw error with all collected errors
    if (!ajvValid || !zodResult.success || customErrors.length > 0) {
      throw new ValidationError(
        'Invalid firewall configuration:\n' + ValidationError.formatErrors(ajvErrors, zodError, customErrors),
        ajvErrors,
        zodError,
        customErrors,
      )
    }
  }

  private validateRuleNames(config: FirewallConfig): void {
    // Check for duplicate rule names
    const names = new Set<string>()
    for (const rule of config.rules) {
      if (names.has(rule.name)) {
        throw new ValidationError(`Duplicate rule name found: "${rule.name}"`, null)
      }
      names.add(rule.name)
    }
  }

  private validateRuleConditionGroup(config: FirewallConfig): void {
    for (const rule of config.rules) {
      // Validate conditionGroup structure
      if (rule.conditionGroup) {
        for (const group of rule.conditionGroup) {
          if (!group.conditions || group.conditions.length === 0) {
            throw new ValidationError(`Rule "${rule.name}" has an empty condition group`, null)
          }
          for (const condition of group.conditions) {
            if (!condition.type || !condition.op) {
              throw new ValidationError(`Rule "${rule.name}" has an invalid condition`, null)
            }

            // Header/Cookie key + value rules
            const requiresKey = condition.type === 'header' || condition.type === 'cookie'
            const isExistsOp = condition.op === 'ex' || condition.op === 'nex'

            if (requiresKey) {
              if (!condition.key || typeof condition.key !== 'string') {
                throw new ValidationError(`Rule "${rule.name}" has an invalid condition`, null)
              }
              // For exists/not-exists, value may be omitted
              if (!isExistsOp && (condition.value === undefined || condition.value === null)) {
                throw new ValidationError(`Rule "${rule.name}" has an invalid condition`, null)
              }
            } else {
              // For non header/cookie, value is always required
              if (condition.value === undefined || condition.value === null) {
                throw new ValidationError(`Rule "${rule.name}" has an invalid condition`, null)
              }
            }

            // Normalize value(s) for further checks
            const values: (string | number)[] = Array.isArray(condition.value)
              ? (condition.value as (string | number)[])
              : condition.value !== undefined
                ? [condition.value as string | number]
                : []

            // If provided, ensure non-empty arrays
            if (Array.isArray(condition.value) && values.length === 0) {
              throw new ValidationError(`Rule "${rule.name}" has an invalid value in condition`, null)
            }

            // Validate specific types
            if (condition.type === 'ip_address') {
              for (const v of values) {
                if (typeof v !== 'string' || !this.isValidIP(v)) {
                  throw new ValidationError(`Rule "${rule.name}" has an invalid IP address in condition`, null)
                }
              }
            }

            if (condition.type === 'geo_as_number') {
              for (const v of values) {
                const asnVal = typeof v === 'number' ? v : parseInt(String(v), 10)
                if (!this.isValidASN(String(asnVal))) {
                  throw new ValidationError(`Rule "${rule.name}" has an invalid ASN in condition`, null)
                }
              }
            }

            if (condition.type === 'path') {
              // Only validate literal path shape for eq/pre where a leading slash is expected
              if (condition.op === 'eq' || condition.op === 'pre') {
                for (const v of values) {
                  if (typeof v !== 'string' || !this.isValidPath(v)) {
                    throw new ValidationError(`Rule "${rule.name}" has an invalid path in condition`, null)
                  }
                }
              }
              // For regex (re) or other operators, skip strict path shape checks
            }
          }
        }
      } else {
        throw new ValidationError('Either conditionGroup or type+values must be provided', null)
      }
    }
  }

  private validateRuleAction(config: FirewallConfig): void {
    for (const rule of config.rules) {
      // Validate action
      if (typeof rule.action === 'object') {
        if ('mitigate' in rule.action) {
          const action = rule.action.mitigate

          if (action?.rateLimit) {
            if (action.rateLimit.requests <= 0) {
              throw new ValidationError('Invalid rate limit configuration: requests must be positive', null)
            }
            if (!action.rateLimit.window.match(/^\d+[smhd]$/)) {
              throw new ValidationError('Invalid rate limit configuration: invalid window format', null)
            }
            const windowValue = parseInt(action.rateLimit.window)
            if (windowValue <= 0) {
              throw new ValidationError('Invalid rate limit configuration: window duration must be positive', null)
            }
          }

          if (action?.actionDuration && !action.actionDuration.match(/^\d+[smhd]$|^permanent$/)) {
            throw new ValidationError('Invalid action duration format: ' + action.actionDuration, null)
          }

          if (action?.redirect && !action.redirect.location) {
            throw new ValidationError('Invalid redirect configuration: location is required', null)
          }
        }
      }
    }
  }

  private isValidIP(value: string): boolean {
    // Validate IPv4/IPv6 (optionally with CIDR) with stricter IPv4 octet checks
    const parts = value.split('/')
    const ipPart = parts[0] ?? ''
    const cidrPart = parts[1]

    const isValidIPv4 = (ip: string): boolean => {
      const octets = ip.split('.')
      if (octets.length !== 4) return false
      return octets.every((octet) => {
        if (!/^\d{1,3}$/.test(octet)) return false
        const n = parseInt(octet, 10)
        return n >= 0 && n <= 255
      })
    }

    const isValidIPv6 = (ip: string): boolean => {
      // Simple IPv6 validation for 8 groups; extended forms are out of scope here
      const hextets = ip.split(':')
      if (hextets.length !== 8) return false
      return hextets.every((h) => /^[0-9a-fA-F]{1,4}$/.test(h))
    }

    const isV4 = isValidIPv4(ipPart)
    const isV6 = isValidIPv6(ipPart)
    if (!isV4 && !isV6) return false

    if (cidrPart !== undefined) {
      const cidrNum = parseInt(cidrPart, 10)
      if (Number.isNaN(cidrNum)) return false
      if (isV4 && (cidrNum < 0 || cidrNum > 32)) return false
      if (isV6 && (cidrNum < 0 || cidrNum > 128)) return false
    }
    return true
  }

  private isValidASN(value: string): boolean {
    // ASN should be a number between 1 and 4294967295
    const num = parseInt(value, 10)
    return !isNaN(num) && num >= 1 && num <= 4294967295
  }

  private isValidPath(value: string): boolean {
    // Path should start with / and not contain spaces
    return value.startsWith('/') && !value.includes(' ')
  }
}
