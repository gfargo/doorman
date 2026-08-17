# Repository Guidelines

## Project Structure & Module Organization
- `src/commands/`: CLI subcommands (`list`, `add`, `remove`, `sync`, `download`, `validate`, `template`, `diff`, `status`, `watch`, `backup`, `export`, `init`, `setup`).
- `src/lib/`: shared code (`services/`, `utils/`, `templates/`, `types.ts`, `ui/`).
- `src/lib/providers/`: Multi-provider abstraction layer (`IFirewallProvider`, `ProviderRegistry`, `ProviderDetector`).
- `src/lib/providers/vercel/`: Vercel provider implementation.
- `src/lib/providers/cloudflare/`: Cloudflare provider implementation (beta).
- `src/lib/translators/`: Rule translation between provider formats.
- `src/lib/errors/`: Structured error handling (`DoormanError`, error codes).
- `src/lib/types/`: Unified type system (`unified.ts`, `vercel.ts`, `cloudflare.ts`).
- `src/constants/` and `src/next/`: constants and Next.js middleware helper (`createDoorman`).
- `src/tests/` and `src/*.test.ts`: Jest tests and mocks.
- `bin/`: CLI entry (`run`, `run.ts`) wired with `yargs`.
- `schema/`: JSON Schema generator (`generate-schema.ts`) and output.
- `examples/`: sample firewall configs. `dist/`: build output (generated).

## Build, Test, and Development Commands
- `pnpm build`: bundle TypeScript to `dist/` via tsup.
- `pnpm build:watch`: watch mode for local development.
- `pnpm start`: run CLI from TypeScript with `ts-node`.
- `pnpm start:node`: run compiled CLI (`bin/run`).
- `pnpm test` | `pnpm test:watch`: run Jest tests.
- `pnpm lint` | `pnpm lint:fix`: ESLint (autofix).
- `pnpm format` | `pnpm format:fix`: Prettier check/format.
- `pnpm build:schema`: regenerate JSON Schema, then lint/format.

## Coding Style & Naming Conventions
- Language: TypeScript. Formatting: Prettier (2 spaces, width 120, single quotes, no semicolons).
- Linting: ESLint with `@typescript-eslint`, `prettier`, `jest`, `unused-imports`.
- Naming: camelCase for variables/functions, PascalCase for types, kebab-case filenames.
- Avoid unused imports (error) and stray `console` calls (warn). Prefer explicit exports.

## Architecture Patterns
- **Provider Abstraction**: `IFirewallProvider` interface with `ProviderRegistry` for multi-provider support.
- **Shared Middleware**: `withCredentials()` handles config loading, provider detection, credential resolution, and error handling for all commands.
- **Centralized Error Handling**: `handleCommandError()` provides consistent error formatting across all commands.
- **Config Loading Modes**: `getConfig()` accepts explicit modes (`'required'`, `'optional'`, `'raw'`, `'lenient'`).
- **Service Layer**: Separate services for API interaction, validation, and firewall operations.
- **Command Pattern**: Each CLI command is a separate module with consistent interface.

## Testing Guidelines
- Framework: Jest + ts-jest (Node environment).
- Location: co-locate as `*.test.ts` or use `src/tests/`.
- Mocks: place under `src/tests/__mocks__/` (e.g., `chalk.ts`).
- Run a single test: `pnpm test -- src/tests/validation.test.ts`.
- 3 Vercel sync integration tests are skipped inline (`test.skip(...)` in `src/tests/commands.integration.test.ts`), not Cloudflare tests, and not via `jest.config.js` (which has no skip configuration).

## Commit & Pull Request Guidelines
- Commits: Conventional Commits enforced by commitlint. Use `pnpm commit` (commitizen) for prompts.
- PRs: small, focused. Include summary, linked issues, and CLI output or screenshots when relevant.
- Releases: semantic-release manages versions/changelog on `main` and prerelease branches.
- Use `--no-verify` sparingly — the pre-commit hook catches lint/format/test issues.

## Branching & Release Strategy
- **`main`**: Stable releases (e.g., `1.5.11`). Pushes trigger semantic-release → npm publish.
- **`beta`**: Prerelease channel (e.g., `1.6.0-beta.1`). Pushes trigger semantic-release → npm publish with `beta` dist-tag.
- **Feature branches**: Branch from `main` (or `beta` for beta work), PR back to the target branch.
- **Commit prefixes control version bumps**:
  - `feat:` → minor bump (1.5.x → 1.6.0)
  - `fix:` → patch bump (1.5.7 → 1.5.8)
  - `feat!:` or `BREAKING CHANGE:` footer → major bump (1.x → 2.0.0)
  - `chore:`, `docs:`, `ci:`, `test:` → no release
- **Beta → Stable**: Merge `beta` into `main` to promote. Add `BREAKING CHANGE:` footer if major bump desired.
- **CI/CD**: `.github/workflows/ci.yml` runs lint/test/build on every PR targeting `main` or `beta`. `.github/workflows/release.yml` runs the same checks plus build/publish on every push to `main` or `beta`.
- **Husky hooks**: Disabled during semantic-release commits via `HUSKY=0` env var in CI.

## Security & Configuration Tips
- Auth: CLI reads env via `dotenv` and flags.
- Vercel env vars: `VERCEL_TOKEN` (required), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`.
- Cloudflare env vars: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID` (optional).
- Do not commit secrets. Keep `dist/` and `.env*` out of VCS (already ignored).
