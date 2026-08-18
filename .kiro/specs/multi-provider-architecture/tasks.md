# Implementation Plan

> Status: COMPLETE. All tasks shipped across Cloudflare Phases 1-5.
> **Depends on:** [unified-config-v2](./../unified-config-v2/) — the unified type system and config format that providers implement against.

## Phase 1: Core Abstractions

- [x] 1. Define IFirewallProvider interface

  - Define `fetchConfig()`, `syncRules()`, `validateConfig()`, `getChanges()` methods
  - Define `getSupportedFeatures()` and `getHealthScore()` for capability declaration
  - Define `verifyCredentials()` for connectivity testing
  - Define supporting types: `SyncOptions`, `SyncResult`, `ChangeSet`, `FeatureSet`, `HealthScore`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 2. Implement ProviderRegistry singleton

  - Create singleton class with factory registration and lazy instantiation
  - Implement `register()`, `get()`, `has()`, `getAvailableProviders()`, `clear()`
  - Add `registerInstance()` for direct registration in tests
  - Add `getSync()` for non-async access to already-created instances
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Implement ProviderDetector
  - Detect from explicit config `provider` field (high confidence)
  - Detect from provider-specific config sections (high confidence)
  - Detect from legacy Vercel root-level `projectId` (high confidence)
  - Detect from `DOORMAN_PROVIDER` env var (high confidence)
  - Detect from provider credential env vars (medium confidence)
  - Fall back to Vercel when unable to detect (low confidence)
  - Implement `detectAll()` for migration scenarios
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

## Phase 2: Unified Types and Translation

- [x] 4. Define unified type system

  - Create `UnifiedConfig`, `UnifiedRule`, `UnifiedCondition`, `UnifiedAction`, `UnifiedIPRule`
  - Define provider-agnostic `FieldType`, `Operator`, and `ActionType` enums
  - Add helper constructors: `createUnifiedCondition()`, `createUnifiedAction()`, `createUnifiedRule()`
  - Add type guards: `isUnifiedConfig()`, `isUnifiedRule()`, `isUnifiedIPRule()`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 5. Implement RuleTranslator

  - Implement `vercelToUnified()` and `unifiedToVercel()` (condition groups ↔ unified)
  - Implement `cloudflareToUnified()` and `unifiedToCloudflare()` (expressions ↔ unified)
  - Implement `vercelToCloudflare()` and `cloudflareToVercel()` (direct translation)
  - Implement `vercelIPToUnified()` and `unifiedIPToCloudflare()` (IP rules)
  - Return `TranslationResult<T>` with warnings for all lossy conversions
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 6. Implement ExpressionBuilder

  - Build Cloudflare wirefilter expressions from unified conditions
  - Build expressions from Vercel condition groups
  - Handle field mapping between provider field names
  - Handle operator mapping between provider operator syntax
  - _Requirements: 5.1, 5.2_

- [x] 7. Implement TranslationWarningSystem
  - Define warning severity levels (critical, warning, info)
  - Define warning categories (feature_unsupported, lossy_conversion, syntax_limitation, etc.)
  - Create structured warning objects with suggestions and docs links
  - Integrate warnings into all translation paths
  - _Requirements: 5.4, 5.6_

## Phase 3: Base Classes

- [x] 8. Implement BaseFirewallClient

  - Create abstract HTTP client with `makeRequest<T>()` method
  - Add retry logic with configurable attempts and exponential backoff
  - Add rate limit detection and automatic wait-and-retry on 429
  - Add timeout handling via AbortController with cleanup
  - Add rate limit info tracking from response headers
  - Define abstract `getAuthHeaders()` for provider-specific auth
  - _Requirements: 7.1, 7.2, 7.6_

- [x] 9. Implement BaseFirewallService
  - Create abstract class implementing `IFirewallProvider`
  - Add generic `validateConfig()` with extensibility for provider overrides
  - Add `getHealthScore()` framework with issue detection and recommendations
  - Add diff utilities for comparing rule arrays by ID
  - _Requirements: 7.3, 7.4, 7.5_

## Phase 4: Provider Implementations

- [x] 10. Implement Vercel provider

  - Create `VercelProvider` factory with `fromEnv()`, `fromConfig()`, `create()` static methods
  - Create `VercelClient` extending `BaseFirewallClient` with Vercel API auth
  - Create `VercelFirewallService` extending `BaseFirewallService` with Vercel-specific logic
  - Implement all `IFirewallProvider` methods for Vercel's API
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 11. Implement Cloudflare provider
  - Create `CloudflareProvider` factory with `fromEnv()`, `fromConfig()`, `create()` static methods
  - Create `CloudflareClient` extending `BaseFirewallClient` with CF API auth
  - Create `CloudflareFirewallService` extending `BaseFirewallService` with CF-specific logic
  - Implement rulesets API, rules CRUD, and Lists API integration
  - Add expression generation for rule sync
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

## Phase 5: Command Integration

- [x] 12. Implement withCredentials() middleware

  - Handle config loading with multiple modes (required, optional, raw, lenient)
  - Integrate ProviderDetector for automatic provider selection
  - Resolve credentials from CLI flags, config, env vars, and interactive prompts
  - Build `CommandContext` with provider instance and legacy compat fields
  - Wrap all command execution in consistent error handling
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 13. Implement initProviders() bootstrap

  - Register Vercel and Cloudflare factory functions at startup
  - Ensure registration is idempotent (safe to call multiple times)
  - Integrate with `getProvider()` helper for ad-hoc provider access
  - _Requirements: 2.1, 2.2_

- [x] 14. Migrate existing commands to provider abstraction
  - Update all commands to use `withCredentials()` middleware
  - Update commands to call `provider.*` methods instead of direct Vercel client
  - Maintain backward compatibility for Vercel-specific workflows
  - Verify all commands work with both Vercel and Cloudflare providers
  - _Requirements: 6.4, 6.5, 6.6_

## Phase 6: Testing

- [x] 15. Test provider infrastructure

  - Unit test ProviderRegistry (singleton, lazy creation, error paths, clear)
  - Unit test ProviderDetector (all signal combinations, confidence levels)
  - Unit test BaseFirewallClient (retries, rate limits, timeouts, cleanup)
  - Unit test BaseFirewallService (validation, health scoring, diffing)
  - _Requirements: 2.5, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 16. Test translation layer

  - Test RuleTranslator for all translation paths with fixture data
  - Test ExpressionBuilder for all condition types and operators
  - Test TranslationWarningSystem for correct severity and messaging
  - Test edge cases: empty rules, unsupported features, malformed input
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 17. Test command integration
  - Test withCredentials() with various config/credential combinations
  - Test provider detection in commands with different setups
  - Test error handling paths through the middleware
  - Verify backward compatibility with legacy Vercel-only configs
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
