# Requirements Document

## Introduction

This spec covers the migration from v1 configuration format (Vercel-only `vercel-firewall.config.json`) to v2 unified configuration format (`.doorman.json`). The v2 format is provider-agnostic, supports multi-provider settings, uses standardized field/operator types, and provides automatic migration from v1.

## Requirements

### Requirement 1: Unified Configuration Format

**User Story:** As a user managing firewall rules across providers, I want a single config file format that works with any provider, so that I don't need separate configs per provider.

#### Acceptance Criteria

1. WHEN I create a new config THEN it SHALL use `.doorman.json` as the primary filename
2. WHEN I define rules THEN they SHALL use provider-agnostic field types (`ip`, `path`, `host`, etc.) and operators (`eq`, `contains`, `starts_with`, etc.)
3. WHEN I specify a provider THEN it SHALL be declared in a top-level `provider` field
4. WHEN I need provider-specific settings THEN they SHALL live in `providers.vercel` or `providers.cloudflare` sections
5. WHEN I define IP blocking rules THEN they SHALL use a separate `ips` array with `UnifiedIPRule` format
6. WHEN I want optional metadata THEN it SHALL be stored in a `metadata` field (version, timestamps, migration info)

### Requirement 2: Schema Validation with Zod

**User Story:** As a user writing config files, I want immediate validation feedback when my config has errors, so that I catch mistakes before deploying.

#### Acceptance Criteria

1. WHEN I load a config THEN it SHALL be validated against Zod schemas with clear error messages
2. WHEN a rule is missing required fields (name, enabled, conditions, action) THEN validation SHALL report which fields are missing
3. WHEN conditions use invalid operators or field types THEN validation SHALL report the invalid values
4. WHEN IP addresses are malformed THEN validation SHALL reject them with guidance
5. WHEN rate limit or redirect config is incomplete THEN validation SHALL show what's missing
6. WHEN `provider` is specified but no matching `providers.*` section exists THEN validation SHALL warn

### Requirement 3: v1 to v2 Automatic Migration

**User Story:** As an existing Vercel user with a `vercel-firewall.config.json`, I want my config automatically migrated to v2 format, so that I can upgrade without manual conversion.

#### Acceptance Criteria

1. WHEN a v1 config is detected THEN the system SHALL auto-migrate it to v2 format in memory
2. WHEN migrating THEN Vercel condition groups SHALL be flattened into unified conditions
3. WHEN migrating THEN `projectId` and `teamId` SHALL move to `providers.vercel`
4. WHEN migrating THEN the `provider` field SHALL be set to `vercel`
5. WHEN migrating THEN metadata SHALL record `migratedFrom: "1.0"` and `migratedAt` timestamp
6. WHEN the original config has IPs THEN they SHALL be preserved in the `ips` array

### Requirement 4: Schema Version Detection

**User Story:** As the system, I need to detect which version of the config schema is in use, so that I can apply the correct parsing and validation logic.

#### Acceptance Criteria

1. WHEN a config has an explicit `version: "2.0"` field THEN it SHALL be treated as v2
2. WHEN a config has `provider` or `providers` fields THEN it SHALL be treated as v2
3. WHEN a config has root-level `projectId` or `teamId` THEN it SHALL be treated as v1
4. WHEN version detection is ambiguous THEN it SHALL default to the current version (2.0)
5. WHEN an unsupported version is detected THEN it SHALL throw with a clear error message

### Requirement 5: Common Type System

**User Story:** As a provider implementer, I want standardized types for actions, operators, and fields, so that translations between providers have a well-defined vocabulary.

#### Acceptance Criteria

1. WHEN defining actions THEN `ActionType` SHALL support: log, deny, challenge, bypass, rate_limit, redirect, allow, block
2. WHEN defining operators THEN `Operator` SHALL support: eq, ne, contains, not_contains, starts_with, ends_with, matches, in, not_in, gt, ge, lt, le, exists, not_exists
3. WHEN defining fields THEN `FieldType` SHALL support: ip, country, region, city, asn, path, host, method, header, query, cookie, user_agent, referer, scheme, port
4. WHEN a provider needs a field not in the standard set THEN conditions SHALL accept arbitrary string field names
5. WHEN providers map fields differently THEN translation SHALL handle the mapping transparently

### Requirement 6: Backward Compatibility

**User Story:** As an existing user, I want my old `vercel-firewall.config.json` to continue working, so that the upgrade doesn't break my workflow.

#### Acceptance Criteria

1. WHEN the system discovers `vercel-firewall.config.json` THEN it SHALL load it with a deprecation warning
2. WHEN both `.doorman.json` and `vercel-firewall.config.json` exist THEN `.doorman.json` SHALL take precedence
3. WHEN loading legacy config THEN all existing commands SHALL continue to work without changes
4. WHEN legacy config is detected THEN the deprecation warning SHALL mention that support will be removed in v3.0
5. WHEN a user runs `init` THEN it SHALL create `.doorman.json` in v2 format

### Requirement 7: JSON Schema for Editor Support

**User Story:** As a user editing config files, I want IDE autocompletion and validation via JSON Schema, so that I get feedback as I type.

#### Acceptance Criteria

1. WHEN I add `"$schema": "https://doorman.griffen.codes/schema.json"` to my config THEN editors SHALL provide autocompletion
2. WHEN `pnpm build:schema` runs THEN it SHALL generate a JSON Schema from the Zod schemas
3. WHEN the schema is published THEN it SHALL validate all v2 config fields including rules, IPs, and provider settings
4. WHEN the schema evolves THEN the URL SHALL remain stable (versioned or backward-compatible)
