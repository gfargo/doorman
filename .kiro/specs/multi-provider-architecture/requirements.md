# Requirements Document

## Introduction

This spec covers the multi-provider architecture that enables Doorman to manage firewall rules across different cloud platforms (initially Vercel and Cloudflare) through a unified interface. The architecture replaces the original Vercel-only design with an abstraction layer that allows new providers to be added without modifying existing commands.

## Requirements

### Requirement 1: Provider Interface Abstraction

**User Story:** As a CLI command author, I want a single interface to interact with any firewall provider, so that commands work identically regardless of which provider the user has configured.

#### Acceptance Criteria

1. WHEN a command needs to fetch remote rules THEN it SHALL call `provider.fetchConfig()` without knowing the underlying provider
2. WHEN a command needs to sync rules THEN it SHALL call `provider.syncRules()` with a unified config format
3. WHEN a command needs to compare local vs remote THEN it SHALL call `provider.getChanges()` and receive a standardized change set
4. WHEN a command needs to validate config THEN it SHALL call `provider.validateConfig()` and receive structured errors/warnings
5. WHEN a provider has specific capabilities THEN `provider.getSupportedFeatures()` SHALL declare what features are supported
6. WHEN credentials need verification THEN `provider.verifyCredentials()` SHALL test connectivity

### Requirement 2: Provider Registry and Lazy Instantiation

**User Story:** As a developer, I want providers to be registered once and instantiated lazily, so that startup is fast and unused providers don't consume resources.

#### Acceptance Criteria

1. WHEN the CLI starts THEN provider factories SHALL be registered but not instantiated
2. WHEN a provider is requested THEN it SHALL be lazily created via its factory and cached for reuse
3. WHEN multiple commands run in sequence THEN the same provider instance SHALL be reused
4. WHEN a provider type is not registered THEN a clear error SHALL list available providers
5. WHEN testing THEN the registry SHALL be clearable to allow isolated test runs

### Requirement 3: Automatic Provider Detection

**User Story:** As a user, I want Doorman to auto-detect which provider I'm using based on my config and environment, so that I don't have to specify it manually on every command.

#### Acceptance Criteria

1. WHEN `provider` is explicit in the config file THEN it SHALL be used with high confidence
2. WHEN provider-specific settings exist in config (`providers.cloudflare.zoneId`) THEN it SHALL detect the provider
3. WHEN legacy Vercel config format is found (`projectId` at root) THEN it SHALL detect Vercel
4. WHEN `DOORMAN_PROVIDER` env var is set THEN it SHALL take precedence over environment credential detection
5. WHEN only environment credentials are present THEN it SHALL detect the provider with medium confidence
6. WHEN no provider can be detected THEN it SHALL fall back to Vercel (legacy default) with a warning

### Requirement 4: Unified Type System

**User Story:** As a rule author, I want a single rule format that works across providers, so that I can define rules once and deploy them anywhere.

#### Acceptance Criteria

1. WHEN I define a rule THEN it SHALL use `UnifiedRule` with conditions, action, and metadata
2. WHEN I define conditions THEN they SHALL use provider-agnostic field types and operators
3. WHEN I define actions THEN they SHALL support deny, allow, challenge, rate_limit, redirect, and log
4. WHEN I define IP rules THEN they SHALL use `UnifiedIPRule` with address, action, and notes
5. WHEN I define a config THEN `UnifiedConfig` SHALL hold rules, IPs, provider settings, and metadata
6. WHEN a provider doesn't support a feature THEN the type system SHALL not prevent the config from loading

### Requirement 5: Bidirectional Rule Translation

**User Story:** As a user switching between providers, I want my rules automatically translated between formats, so that I don't have to rewrite them manually.

#### Acceptance Criteria

1. WHEN syncing to Cloudflare THEN unified rules SHALL be translated to Cloudflare wirefilter expressions
2. WHEN fetching from Cloudflare THEN rules SHALL be translated back to unified format
3. WHEN syncing to Vercel THEN unified rules SHALL be translated to Vercel condition groups
4. WHEN translation is lossy THEN warnings SHALL explain what was lost and suggest alternatives
5. WHEN IP rules are translated to Cloudflare THEN they SHALL become expression-based rules or Lists entries
6. WHEN translation encounters unsupported features THEN it SHALL skip gracefully with warnings, not fail

### Requirement 6: Shared Command Middleware

**User Story:** As a CLI command implementer, I want config loading, provider detection, and credential resolution handled automatically, so that each command doesn't duplicate this logic.

#### Acceptance Criteria

1. WHEN any command runs THEN `withCredentials()` SHALL load config, detect provider, resolve credentials, and pass a `CommandContext`
2. WHEN config is missing and required THEN it SHALL error with guidance on how to create one
3. WHEN credentials are missing THEN it SHALL prompt interactively (or error in CI mode)
4. WHEN the provider is Vercel THEN backward-compatible `client` and `service` fields SHALL be populated
5. WHEN the provider is Cloudflare THEN only `provider` SHALL be meaningful in the context
6. WHEN an error occurs at any stage THEN `handleCommandError()` SHALL format it consistently

### Requirement 7: Base Classes for Provider Implementers

**User Story:** As a provider author, I want base classes that handle common concerns like HTTP retries, rate limiting, diffing, and validation, so that I only implement provider-specific logic.

#### Acceptance Criteria

1. WHEN making API calls THEN `BaseFirewallClient` SHALL handle retries with exponential backoff
2. WHEN rate-limited THEN the client SHALL wait and retry automatically
3. WHEN comparing rule sets THEN `BaseFirewallService` SHALL provide diff utilities
4. WHEN validating config THEN the base service SHALL provide generic validation that providers can extend
5. WHEN calculating health scores THEN the base service SHALL provide a framework with provider overrides
6. WHEN requests time out THEN the client SHALL abort cleanly without resource leaks
