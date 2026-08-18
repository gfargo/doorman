# Requirements Document

## Introduction

This feature spec covers the essential work needed to make Cloudflare support production-ready for Doorman. Based on the current state (Phases 1-5 complete), the core Cloudflare functionality is implemented and working, but several critical areas need attention before we can confidently ship to users. This spec focuses on the minimum viable improvements needed for a stable, user-friendly Cloudflare release.

> **Depends on:** [multi-provider-architecture](./../multi-provider-architecture/) — this spec builds on the provider abstraction, unified types, and translation layer established there.

## Requirements

### Requirement 1: Enhanced Error Handling and User Experience

**User Story:** As a user encountering issues with Cloudflare, I want clear, actionable error messages, so that I can quickly resolve problems and successfully use the tool.

#### Acceptance Criteria

1. WHEN any Cloudflare API error occurs THEN the system SHALL display a structured error with error code, description, and suggested actions
2. WHEN Cloudflare credentials are invalid or missing THEN the error SHALL guide me to the correct credential setup with specific environment variable names
3. WHEN Cloudflare rate limiting occurs THEN the error SHALL show retry timing and suggest using built-in retry mechanisms
4. WHEN Cloudflare zone or account configuration is wrong THEN the error SHALL specify which IDs are invalid and how to find the correct ones
5. WHEN rule translation produces warnings THEN they SHALL be clearly formatted and explain what functionality might be limited
6. WHEN Lists API is unavailable (no account ID) THEN the system SHALL clearly explain the fallback to individual IP rules
7. WHEN validation fails THEN errors SHALL show exactly which configuration fields are problematic and how to fix them

### Requirement 2: Essential Testing Coverage

**User Story:** As a maintainer, I want confidence that Cloudflare functionality works reliably, so that I can ship updates without breaking user workflows.

#### Acceptance Criteria

1. WHEN I run the test suite THEN it SHALL include unit tests for all critical Cloudflare provider components
2. WHEN I test Cloudflare client operations THEN it SHALL cover CRUD operations for rulesets, rules, and lists
3. WHEN I test rule translation THEN it SHALL verify bidirectional translation between Vercel, Unified, and Cloudflare formats
4. WHEN I test error scenarios THEN it SHALL validate error handling for common API failures and edge cases
5. WHEN I test credential validation THEN it SHALL verify both valid and invalid credential scenarios
6. WHEN I test the sync workflow THEN it SHALL validate the complete fetch/diff/sync cycle with mocked APIs
7. WHEN I check test coverage THEN Cloudflare provider code SHALL have at least 80% coverage

### Requirement 3: User Documentation and Migration Guidance

**User Story:** As a new Cloudflare user, I want clear setup and migration documentation, so that I can successfully configure and use Doorman with Cloudflare.

#### Acceptance Criteria

1. WHEN I want to set up Cloudflare THEN there SHALL be a complete setup guide with step-by-step instructions
2. WHEN I need to find my Cloudflare credentials THEN the documentation SHALL explain how to get API tokens, zone IDs, and account IDs
3. WHEN I want to migrate from Vercel THEN there SHALL be a migration guide explaining the process and limitations
4. WHEN I encounter issues THEN there SHALL be a troubleshooting section with common problems and solutions
5. WHEN I want to understand feature differences THEN there SHALL be a comparison matrix showing what works with each provider
6. WHEN I need configuration examples THEN there SHALL be sample configs for common use cases
7. WHEN I want to understand limitations THEN the documentation SHALL clearly explain current Cloudflare support gaps

### Requirement 4: Stability and Bug Fixes

**User Story:** As a user, I want Cloudflare functionality to work reliably without crashes or data loss, so that I can use it in production environments.

#### Acceptance Criteria

1. WHEN I run any command with Cloudflare THEN it SHALL handle network failures gracefully without crashing
2. WHEN API responses are malformed or unexpected THEN the system SHALL handle them without throwing unhandled exceptions
3. WHEN I sync large rule sets THEN the operation SHALL complete successfully without memory issues or timeouts
4. WHEN I use Lists API without account ID THEN the fallback to individual rules SHALL work correctly
5. WHEN translation produces warnings THEN the system SHALL continue operation and not fail
6. WHEN I interrupt operations (Ctrl+C) THEN the system SHALL clean up gracefully without leaving partial state
7. WHEN configuration validation fails THEN it SHALL not corrupt existing configuration files

### Requirement 5: Performance and Reliability Improvements

**User Story:** As a user with multiple rules, I want Cloudflare operations to complete in reasonable time, so that I can efficiently manage my firewall configuration.

#### Acceptance Criteria

1. WHEN I sync rules to Cloudflare THEN operations SHALL complete within 30 seconds for typical configurations (10-50 rules)
2. WHEN I fetch current configuration THEN it SHALL complete within 10 seconds for typical setups
3. WHEN API calls fail temporarily THEN the system SHALL retry with exponential backoff automatically
4. WHEN I run status checks THEN they SHALL complete within 5 seconds
5. WHEN I validate configuration THEN it SHALL complete within 3 seconds for typical configs
6. WHEN multiple API calls are needed THEN they SHALL be batched or parallelized where possible
7. WHEN I run repeated operations THEN the system SHALL cache results appropriately to avoid redundant API calls

### Requirement 6: Configuration and Setup Improvements

**User Story:** As a user setting up Cloudflare, I want the configuration process to be smooth and well-validated, so that I can get started quickly without trial and error.

#### Acceptance Criteria

1. WHEN I run `init --provider cloudflare` THEN it SHALL validate credentials before creating configuration
2. WHEN I provide invalid zone or account IDs THEN the init process SHALL detect this and provide helpful guidance
3. WHEN I have existing Vercel configuration THEN the system SHALL offer to help migrate to multi-provider format
4. WHEN configuration is missing required fields THEN validation SHALL provide specific guidance on what's needed
5. WHEN I use environment variables THEN the system SHALL clearly indicate which variables are being used
6. WHEN I have both config file and environment variables THEN the precedence SHALL be clear and documented
7. WHEN I want to test my setup THEN there SHALL be a way to verify connectivity without making changes
