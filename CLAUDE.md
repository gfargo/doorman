# Doorman Development Guidelines

## Overview
Doorman is a CLI tool for managing firewall rules as code across multiple providers. It supports Vercel Firewall (stable) and Cloudflare WAF (beta), enabling version control and automated deployment of security configurations.

## Commands
- **Build:** `pnpm build`, `pnpm build:watch`, `pnpm build:schema`
- **Lint/Format:** `pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm format:fix`
- **Test:** `pnpm test`, `pnpm test:watch`, `pnpm test:ci`
- **Single Test:** `pnpm test -- -t "test name pattern"`
- **Start/Run:** `pnpm start` or `./bin/run`
- **Audit:** `pnpm audit --audit-level=moderate` (CI uses moderate threshold)

## Available CLI Commands
All commands accept `--provider vercel|cloudflare` (auto-detected if not specified), `--debug`, and `--ci` flags.

- **list:** Display firewall rules - `doorman list [configVersion]`
- **sync:** Push local config to provider - `doorman sync`
- **download:** Import rules from provider - `doorman download [configVersion]`
- **template:** Add rule templates - `doorman template [templateName]`
- **validate:** Check config validity - `doorman validate`
- **status:** Check sync status and config health - `doorman status`
- **diff:** Show detailed changes between local and remote - `doorman diff`
- **watch:** Auto-sync on file changes - `doorman watch`
- **backup:** Create/restore configuration backups - `doorman backup`
- **export:** Export in multiple formats - `doorman export`
- **init:** Initialize new configuration - `doorman init`
- **setup:** Show comprehensive setup guide - `doorman setup`

## Code Style
- **TypeScript:** Strict type checking, explicit return types
- **Formatting:** No semicolons, 120 char width, single quotes
- **Imports:** No unused imports (enforced by eslint)
- **Naming:** PascalCase for classes/services, camelCase for variables/functions
- **Error Handling:** Use `handleCommandError()` in commands, `DoormanError` for structured errors

## Structure
- **Commands:** CLI commands in `src/commands/`, use `withCredentials()` middleware
- **Providers:** Multi-provider abstraction in `src/lib/providers/` (`IFirewallProvider` interface)
- **Services:** Legacy Vercel logic in `src/lib/services/`
- **Translators:** Rule translation in `src/lib/translators/`
- **Templates:** Predefined rule templates in `src/lib/templates/`
- **Utils:** Helper functions in `src/lib/utils/` (`withCredentials`, `handleCommandError`, `config`)
- **Types:** Unified type system in `src/lib/types/` (vercel, cloudflare, unified)
- **Next.js Integration:** Next.js middleware in `src/next/`

## Best Practices
- Use logger service instead of console.log
- Write unit tests for new functionality
- Follow conventional commit format (`feat:`, `fix:`, `chore:`, etc.)
- Handle API errors and rate limits
- Use `withCredentials()` for commands that need provider/credentials
- Use `handleCommandError()` for consistent error handling in catch blocks
- Use `getConfig()` with explicit mode strings (`'required'`, `'optional'`, `'raw'`, `'lenient'`)
- Mock `process.exit` in tests to prevent Jest worker crashes

## Testing
- **Test Coverage:** 141+ passing Vercel tests, 26+ passing Cloudflare test suites
- **Test Structure:** Integration tests, edge cases, validation, sync/download
- **Mocking:** Mock VercelClient, process.exit, and external dependencies
- **CI/CD:** Lint/test/build run on every PR targeting main or beta (`.github/workflows/ci.yml`); the full release pipeline (lint/test/build/publish) runs again on every push to main or beta (`.github/workflows/release.yml`)
- **Skipped Tests:** 3 Vercel sync integration tests are skipped inline (`test.skip(...)` in `src/tests/commands.integration.test.ts`), not Cloudflare tests, and not via `jest.config.js` (which has no skip configuration)

## Security & Dependencies
- **Audit Level:** Moderate severity threshold in CI/CD
- **Overrides:** Use pnpm overrides in package.json for vulnerable deps

## Branching & Release Strategy
- **`main` branch**: Stable releases (e.g., `1.5.11`). Semantic-release auto-publishes to npm.
- **`beta` branch**: Prerelease channel (e.g., `1.6.0-beta.1`). Auto-publishes with `beta` dist-tag.
- **Feature branches**: Branch from target (`main` or `beta`), PR back.
- **Version bumps via commit prefix**:
  - `feat:` → minor (1.5.x → 1.6.0)
  - `fix:` → patch (1.5.7 → 1.5.8)
  - `feat!:` or `BREAKING CHANGE:` footer → major (1.x → 2.0.0)
  - `chore:`, `docs:`, `ci:`, `test:` → no release
- **Promoting beta to stable**: Merge `beta` into `main`.
- **CI workflow**: `.github/workflows/release.yml` triggers on `main` and `beta`.
- **Husky**: Disabled in CI release step via `HUSKY=0` to prevent pre-commit hooks blocking semantic-release.
