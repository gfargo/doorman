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

- `IFirewallProvider.ts` - Core provider interface. Also the home of `PROVIDER_TYPES`, the single source of truth for the closed set of known providers — `ProviderType` derives from it, and every runtime list (CLI `--provider` choices, `ProviderDetector`, the interactive picker) reads it rather than repeating the literal list.
- `credentials.ts` - `CredentialDescriptor`/`resolveCredentials`/`CREDENTIAL_DESCRIPTORS` — each provider declares its credentials (flag key, env var, required/secret, config-file path) once in its own directory; this composes them and applies the shared flag > config > env precedence.
- `ProviderRegistry.ts` - Singleton registry for provider instances
- `ProviderDetector.ts` - Auto-detect provider from config/environment
- `BaseFirewallClient.ts` - Base class for REST-with-header-auth API clients. Optional, not mandatory — built directly on `fetch`/`RequestInit`, so it fits Vercel/Cloudflare but shouldn't be forced onto a provider with a structurally different transport (e.g. an SDK-based client). See `adding-a-provider.md`.
- `BaseFirewallService.ts` - Base class for firewall services (provider-agnostic `validateConfig()`/`getHealthScore()`/`diffRules()`/`diffIPs()` scaffolding)
- `initProviders.ts` - Provider initialization
- `vercel/` - Vercel provider: `VercelProvider`, `VercelClient`, `VercelFirewallService`, `credentials.ts`, `translator.ts` (Vercel↔Unified rule translation, split out of the old monolithic `RuleTranslator` — see Translators below)
- `cloudflare/` - Cloudflare provider: `CloudflareProvider`, `CloudflareClient`, `CloudflareFirewallService`, `CloudflareErrorHandler`, `CloudflareOptimizer`, `CloudflareConfigValidator`, `CloudflareSetupVerifier`, `CloudflareValidator`, `credentials.ts`, `translator.ts`
- `__tests__/conformance.test.ts` - Invariants every `IFirewallProvider` implementation must satisfy, run generically across `PROVIDER_TYPES`. See `adding-a-provider.md` for what a new provider needs to add here.

### Core Library (`src/lib/`)

#### Services (`src/lib/services/`)

- `ValidationService.ts` - Configuration validation logic
- The legacy Vercel-only `FirewallService.ts`/`VercelClient.ts` stack (pre-`IFirewallProvider`) was removed in #176, once every command routed through the generic provider interface for both providers. If you find references to it, they're either historical (git log, `.kiro/specs/multi-provider-architecture/`) or stale docs worth fixing.

#### Translators (`src/lib/translators/`)

- `RuleTranslator.ts` - Thin static-method facade over each provider's translator module (`vercel/translator.ts`, `cloudflare/translator.ts` — see Provider Abstraction above). Split out in #196 so a provider's translation logic lives with the rest of that provider's adapter instead of accumulating in one shared file; existing call sites (`CloudflareFirewallService`, `VercelFirewallService`, `vercelConfigAdapter`) go through this facade unchanged.
- `TranslationTypes.ts` - `TranslationWarning`/`TranslationResult`/severity & category types, shared by every translator module and by `TranslationWarningSystem`
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

⚠️ **`src/lib/types.ts` (a flat file, sibling to the `types/` directory) shadows `src/lib/types/index.ts`** for any `from '../lib/types'` import — file resolution wins over directory resolution, so most of the codebase actually resolves that import path to the flat file, not the directory index. The flat file re-exports selected items from `types/unified.ts` etc. Any new export added to `types/index.ts` must ALSO be added to the flat `types.ts`'s re-export list, or it silently won't be visible to the ~majority of the codebase importing `'../lib/types'` — it'll only be visible to code that imports directly from `types/unified.ts` (etc.). When in doubt, import new shared exports directly from their source file under `types/` rather than relying on either aggregator.

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
- `testHelpers/` - Shared test mocking utilities (not test files themselves — kept out of any `__tests__/` dir so Jest doesn't try to run them as suites): `providerMocks.ts` (`mockCloudflareClientPrototype`, `emptyCloudflareRuleset`) and `loggerMock.ts` (`createLoggerMock`). Reuse these for any new command-handler test that needs a mocked Cloudflare/Vercel client or logger — see the Testing Gotchas section in `tech.md` for why partial/ad-hoc mocks here are a trap.
- `*.test.ts` - Integration and validation tests
- Provider tests in `src/lib/providers/cloudflare/__tests__/` and `src/lib/providers/vercel/__tests__/`, including each provider's own `translator.test.ts` (post-#196 — `RuleTranslator.test.ts` no longer exists as one file; its Vercel/Cloudflare cases moved here)
- Provider conformance suite in `src/lib/providers/__tests__/conformance.test.ts` (#197) — invariants every `IFirewallProvider` must satisfy, run generically across `PROVIDER_TYPES`
- Remaining translator-infrastructure tests (not provider-specific) in `src/lib/translators/__tests__/`: `ExpressionBuilder`, `WirefilterParser`, `TranslationWarningSystem`
- Schema tests in `src/lib/schemas/__tests__/`
- Utility tests in `src/lib/utils/__tests__/`
- Error tests in `src/lib/errors/__tests__/`
- Command tests in `src/commands/__tests__/` - every command now has coverage (as of #98), including both Vercel and Cloudflare provider paths where a command supports both

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
