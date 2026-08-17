/**
 * Type system exports
 * Provides a unified type system for multi-provider firewall management
 */

// Common types
export type {
  ActionType,
  Operator,
  FieldType,
  ConfigMetadata,
  ProviderConfig,
  Credentials,
  RateLimit,
  Redirect,
  BaseConfig,
  ProvidersConfig,
} from './common'

// Vercel types
export type {
  VercelRuleOperator,
  VercelRuleType,
  VercelRuleCondition,
  VercelConditionGroup,
  VercelRateLimit,
  VercelRedirect,
  VercelMitigationAction,
  VercelRuleAction,
  VercelCustomRule,
  VercelIPBlockingRule,
  VercelProjectConfig,
  VercelFirewallConfig,
  VercelFirewallAPIResponse,
  // Legacy re-exports
  RuleOperator,
  RuleType,
  RuleCondition,
  ConditionGroup,
  MitigationAction,
  RuleAction,
  CustomRule,
  IPBlockingRule,
  ProjectConfig,
  FirewallConfig,
} from './vercel'

// Cloudflare types
export type {
  CloudflareRulesetKind,
  CloudflareRulesetPhase,
  CloudflareAction,
  CloudflareBlockActionParameters,
  CloudflareRedirectActionParameters,
  CloudflareRateLimit,
  CloudflareSkipActionParameters,
  CloudflareActionParameters,
  CloudflareRule,
  CloudflareRuleset,
  CloudflareZoneConfig,
  CloudflareFirewallConfig,
  CloudflareAPIResponse,
  CloudflareAPIError,
  CloudflareAPIMessage,
  CloudflareResultInfo,
  CloudflareCreateRulesetRequest,
  CloudflareUpdateRulesetRequest,
  CloudflareCreateRuleRequest,
  CloudflareUpdateRuleRequest,
  CloudflareFieldType,
} from './cloudflare'

// Unified types
export type { UnifiedCondition, UnifiedAction, UnifiedRule, UnifiedIPRule, UnifiedConfig } from './unified'

export {
  isUnifiedConfig,
  isUnifiedRule,
  isUnifiedIPRule,
  hasProviderMetadata,
  createUnifiedCondition,
  createUnifiedAction,
  createUnifiedRule,
} from './unified'
