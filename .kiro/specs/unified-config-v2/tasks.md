# Implementation Plan

> Status: COMPLETE. Unified config v2 is shipped and in production use.

## Phase 1: Common Types and Schemas

- [x] 1. Define common type system

  - Define `ActionType` union: log, deny, challenge, bypass, rate_limit, redirect, allow, block
  - Define `Operator` union: eq, ne, contains, not_contains, starts_with, ends_with, matches, in, not_in, gt, ge, lt, le, exists, not_exists
  - Define `FieldType` union: ip, country, region, city, asn, path, host, method, header, query, cookie, user_agent, referer, scheme, port
  - Define `ConfigMetadata` and `ProvidersConfig` interfaces
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 2. Create common Zod schemas
  - Create `actionTypeSchema`, `operatorSchema`, `fieldTypeSchema` from type definitions
  - Create `rateLimitSchema`, `redirectSchema` for action sub-objects
  - Create `configMetadataSchema`, `providersConfigSchema`, `baseConfigSchema`
  - Create utility schemas: `idSchema`, `ipAddressSchema`, `timestampSchema`, `durationSchema`
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

## Phase 2: Unified Config Types and Schemas

- [x] 3. Define unified type interfaces

  - Create `UnifiedCondition` with field, operator, value, negated, key
  - Create `UnifiedAction` with type, rateLimit, redirect, response, duration
  - Create `UnifiedRule` with id, name, description, enabled, conditions, conditionLogic, action, priority, categories
  - Create `UnifiedIPRule` with id, ip, hostname, notes, action
  - Create `UnifiedConfig` with $schema, version, provider, providers, rules, ips, metadata
  - Add type guards: `isUnifiedConfig()`, `isUnifiedRule()`, `isUnifiedIPRule()`
  - Add helper constructors: `createUnifiedCondition()`, `createUnifiedAction()`, `createUnifiedRule()`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.4_

- [x] 4. Create unified Zod schemas
  - Create `unifiedConditionSchema` with field accepting both FieldType and custom strings
  - Create `unifiedActionSchema` with optional rateLimit, redirect, response
  - Create `unifiedRuleSchema` requiring name, enabled, conditions (min 1), action
  - Create `unifiedIPRuleSchema` with IP validation (IPv4, IPv6, CIDR)
  - Create `unifiedConfigSchema` extending baseConfigSchema with rules, ips, providers, metadata
  - Implement `validateUnifiedConfig()` with provider-section cross-validation
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

## Phase 3: Version Detection and Migration

- [x] 5. Implement schema version detection

  - Detect v2 by explicit `version: "2.0"` field
  - Detect v2 by presence of `provider` or `providers` fields
  - Detect v1 by presence of root-level `projectId` or `teamId`
  - Default to current version (2.0) for ambiguous configs
  - Implement `needsMigration()` helper
  - Implement `isCompatibleVersion()` for supported version checking
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 6. Implement v1→v2 migration
  - Create `migrateV1ToV2()` function converting FirewallConfig to UnifiedConfig
  - Move `projectId`/`teamId` to `providers.vercel`
  - Set `provider: "vercel"` and `version: "2.0"`
  - Flatten Vercel condition groups into unified conditions array
  - Map Vercel operators to unified operators (pre→starts_with, sub→contains, etc.)
  - Map Vercel field types to unified fields (ip_address→ip, geo_country→country, etc.)
  - Convert `action.mitigate.*` to flat `action.*` structure
  - Map `active` to `enabled`
  - Preserve IPs in `ips` array
  - Add migration metadata (migratedFrom, migratedAt)
  - Implement `autoMigrate()` entry point for transparent usage
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

## Phase 4: Config Discovery and Loading

- [x] 7. Update config discovery for v2

  - Add `.doorman.json` as primary discovery target
  - Keep `vercel-firewall.config.json` as fallback with deprecation warning
  - Keep `vercel-firewall[project-name].config.json` as legacy fallback
  - Implement precedence: explicit flag > `.doorman.json` > legacy files
  - Add deprecation warning when legacy file is discovered
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 8. Update config loading with mode system
  - Implement `getConfig()` with explicit modes: `'required'`, `'optional'`, `'raw'`, `'lenient'`
  - In `'required'` mode: load, validate, error if missing or invalid
  - In `'optional'` mode: return empty config if file not found
  - In `'raw'` mode: load without schema validation
  - In `'lenient'` mode: load with warnings but don't error on validation
  - Apply auto-migration when v1 config is loaded
  - _Requirements: 6.3, 3.1_

## Phase 5: JSON Schema Generation

- [x] 9. Set up JSON Schema generation pipeline
  - Create `schema/generate-schema.ts` script
  - Convert Zod schemas to JSON Schema using `zod-to-json-schema`
  - Output to `schema/doorman.schema.json`
  - Integrate into `pnpm build:schema` command
  - Publish schema at `https://doorman.griffen.codes/schema.json`
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

## Phase 6: Init Command Update

- [x] 10. Update init command for v2 format
  - Generate `.doorman.json` with v2 structure when running `doorman init`
  - Include `$schema` reference for editor support
  - Prompt for provider selection (vercel/cloudflare)
  - Pre-fill provider-specific settings section
  - Include example rules and comments
  - _Requirements: 6.5, 1.1_

## Phase 7: Testing

- [x] 11. Test schema validation

  - Test all field types, operators, and action types validate correctly
  - Test validation rejects invalid values with helpful messages
  - Test IP address validation (IPv4, IPv6, CIDR)
  - Test rate limit and redirect sub-schema validation
  - Test provider cross-validation (provider declared but section missing)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 12. Test version detection and migration

  - Test detection of v1 configs (projectId, teamId signals)
  - Test detection of v2 configs (version field, provider/providers fields)
  - Test auto-migration from v1 to v2 preserves all rule data
  - Test operator mapping accuracy for all Vercel operators
  - Test field type mapping accuracy for all Vercel types
  - Test metadata is correctly set during migration
  - Test edge cases: empty rules, missing IPs, partial conditions
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 13. Test config discovery and backward compatibility

  - Test `.doorman.json` is found as primary config
  - Test legacy `vercel-firewall.config.json` still loads with warning
  - Test precedence when both files exist
  - Test config loading modes (required, optional, raw, lenient)
  - Test all existing commands work with v2 format
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 14. Test JSON Schema output
  - Test schema generation produces valid JSON Schema
  - Snapshot test schema output for regression detection
  - Test $schema reference works in editors (manual verification)
  - _Requirements: 7.1, 7.2, 7.3_
