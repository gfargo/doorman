# Project Structure

## Root Level

- **bin/**: CLI entry point with shebang for executable
- **dist/**: Built output (CJS and ESM bundles)
- **docs/**: Internal planning docs, roadmaps, and references (git-ignored, not published)
- **examples/**: Sample configuration files demonstrating various rule patterns
- **schema/**: JSON schema generation and validation files
- **.wiki/**: GitHub Wiki checkout — source of truth for user-facing documentation (separate git repo, git-ignored)

## Source Organization (`src/`)

### Commands (`src/commands/`)

Each command uses `withCredentials()` middleware for config/credential setup:

- `list.ts` - Display firewall rules
- `sync.ts` - Synchronize local config with provider
- `download.ts` - Import rules from provider to local config
- `validate.ts` - Validate configuration files
- `template.ts` - Add predefined rule templates
- `diff.ts` - Show detailed differences between local and remote
- `status.ts` - Show sync status and config health
- `watch.ts` - Auto-sync on file changes
- `backup.ts` - Create/restore configuration backups
- `export.ts` - Export in multiple formats (JSON, YAML, Terraform, Markdown)
- `init.ts` - Initialize new configuration
- `setup.ts` - Show setup guide
- `index.ts` - Command registry

### Provider Abstraction (`src/lib/providers/`)

- `IFirewallProvider.ts` - Core provider interface
- `ProviderRegistry.ts` - Singleton registry for provider instances
- `ProviderDetector.ts` - Auto-detect provider from config/environment
- `BaseFirewallClient.ts` - Base class for API clients
- `BaseFirewallService.ts` - Base class for firewall services
- `initProviders.ts` - Provider initialization
- `vercel/` - Vercel provider (VercelProvider, VercelClient, VercelFirewallService)
- `cloudflare/` - Cloudflare provider (CloudflareProvider, CloudflareClient, CloudflareFirewallService, CloudflareErrorHandler, CloudflareOptimizer, CloudflareConfigValidator, CloudflareSetupVerifier, CloudflareValidator)

### Core Library (`src/lib/`)

#### Services (`src/lib/services/`)

- `FirewallService.ts` - Legacy Vercel business logic for rule management
- `VercelClient.ts` - Legacy Vercel API integration
- `ValidationService.ts` - Configuration validation logic

#### Translators (`src/lib/translators/`)

- `RuleTranslator.ts` - Bidirectional rule translation between providers
- `FieldMapper.ts` - Field mapping between provider formats
- `ExpressionBuilder.ts` - Cloudflare expression building
- `TranslationWarningSystem.ts` - Warning surfacing for lossy translations

#### Errors (`src/lib/errors/`)

- `DoormanError.ts` - Structured error class with codes and suggestions
- `ErrorCodes.ts` - Error code definitions
- `helpers.ts` - Error creation helpers

#### Types (`src/lib/types/`)

- `unified.ts` - Provider-agnostic types (UnifiedConfig, UnifiedRule)
- `vercel.ts` - Vercel-specific types
- `cloudflare.ts` - Cloudflare-specific types
- `common.ts` - Shared type definitions

#### Schemas (`src/lib/schemas/`)

- `firewallSchemas.ts` - Zod schemas for Vercel configuration
- `cloudflareSchemas.ts` - Zod schemas for Cloudflare configuration
- `unifiedSchemas.ts` - Zod schemas for unified configuration
- `commonSchemas.ts` - Shared schema definitions
- `schemaVersion.ts` - Version detection and v1→v2 migration

#### Templates (`src/lib/templates/`)

- `index.ts` - Template registry
- `rules/` - Individual template implementations (ai-bots, bad-bots, etc.)
- `types.ts` - Template-specific types

#### UI Components (`src/lib/ui/`)

- `prompt.ts` - Interactive CLI prompts
- `promptForCredentials.ts` - Credential resolution prompts
- `table/` - Table formatting utilities for rule display

#### Utilities (`src/lib/utils/`)

- `withCredentials.ts` - Shared middleware for config/credential/provider setup
- `handleCommandError.ts` - Centralized error handler for all commands
- `config.ts` - Configuration file handling with explicit load modes
- `configFinder.ts` - Automatic config discovery
- `providerHelper.ts` - Provider detection and instantiation
- `isDeepEqual.ts` - Deep object comparison
- `toSnakeCase.ts` - String transformation utilities
- `retry.ts` - API retry logic
- `errorFormatter.ts` - Error message formatting
- `configHealth.ts` - Configuration health scoring
- `batch.ts` - Batch processing utilities
- `cache.ts` - API response caching
- `networkResilience.ts` - Network failure handling
- `operationSafety.ts` - Destructive operation safeguards
- `gracefulShutdown.ts` - Ctrl+C handling
- `backupGuidance.ts` - Backup recommendations

### Constants (`src/constants/`)

- `blockedPaths.ts` - Default blocked path patterns
- `schema.ts` - Schema-related constants

### Next.js Integration (`src/next/`)

- `createDoorman.ts` - Middleware for Next.js applications

### Testing (`src/tests/`)

- `__mocks__/` - Test mocks (e.g., chalk mock)
- `*.test.ts` - Integration and validation tests
- Provider tests in `src/lib/providers/cloudflare/__tests__/` and `src/lib/providers/vercel/__tests__/`
- Translator tests in `src/lib/translators/__tests__/`
- Schema tests in `src/lib/schemas/__tests__/`
- Utility tests in `src/lib/utils/__tests__/`
- Error tests in `src/lib/errors/__tests__/`

## Configuration Files

- `.doorman.json` - Default configuration file (new in v2.0)
- `vercel-firewall.config.json` - Legacy configuration file (still supported)
- `vercel-firewall[project-name].config.json` - Legacy project-specific configs

## Naming Conventions

- **Files**: kebab-case for directories, camelCase for TypeScript files
- **Types**: PascalCase interfaces and types
- **Functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Rule IDs**: snake*case with `rule*` prefix
