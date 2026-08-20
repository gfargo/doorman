# Technology Stack

## Core Technologies

- **TypeScript**: Primary language with strict type checking
- **Node.js 20**: Runtime environment (extends @tsconfig/node20)
- **Zod**: Runtime schema validation and type inference
- **Yargs**: CLI argument parsing and command structure

## Build System

- **tsup**: Modern TypeScript bundler for both CJS and ESM outputs
- **pnpm**: Package manager with lock file
- **TypeScript**: Compilation with declaration files and source maps

## Testing & Quality

- **Jest**: Testing framework with ts-jest preset
- **ESLint**: Linting with TypeScript, Prettier, and Jest plugins
- **Prettier**: Code formatting
- **Husky**: Git hooks for pre-commit validation
- **Commitlint**: Conventional commit message validation

## Key Dependencies

- **chalk**: Terminal styling and colors
- **consola**: Structured logging
- **cli-table3**: Terminal table formatting
- **ajv**: JSON schema validation
- **dotenv**: Environment variable management
- **find-up**: Configuration file discovery

## Common Commands

### Development

```bash
pnpm start              # Run CLI in development mode
pnpm build              # Build for production
pnpm build:watch        # Build with file watching
pnpm clean              # Clean dist directory
```

### Testing & Quality

```bash
pnpm test               # Run full test suite (~78 suites, ~1380 tests as of August 2026 — check for the current count rather than trusting this)
pnpm test:watch         # Run tests in watch mode
pnpm test -- <path>     # Run a single test file
pnpm lint               # Check code style
pnpm lint:fix           # Fix linting issues
pnpm format             # Check formatting
pnpm format:fix         # Fix formatting
```

### Schema & Release

```bash
pnpm build:schema       # Generate JSON schema from TypeScript types
pnpm release            # Semantic release
```

## Architecture Patterns

- **Provider Abstraction**: `IFirewallProvider` interface with `ProviderRegistry` for multi-provider support (Vercel stable, Cloudflare beta). `PROVIDER_TYPES` in `IFirewallProvider.ts` is the single source of truth for the closed set of known providers — see `.kiro/steering/adding-a-provider.md` for the current, short checklist of what adding one actually touches (deliberately restructured in August 2026 so this isn't a dozen-file change anymore).
- **Provider Credentials**: each provider declares its credentials once, in its own directory (`src/lib/providers/<name>/credentials.ts`), as a `CredentialDescriptor` — flag key, env var, label, required/secret, and (for non-secrets) where it can live in a config file. `resolveCredentials()` in `src/lib/providers/credentials.ts` applies the shared flag > config > env precedence from the descriptor, rather than every call site re-deriving it. This replaced env-var names that used to be bare string literals repeated across resolution, detection, prompting, and validation code — the duplication that let a real bug (#193: Cloudflare silently ignoring a config-declared `zoneId`) go unnoticed.
- **Provider Conformance Suite**: `src/lib/providers/__tests__/conformance.test.ts` (#197) runs a fixed set of invariants against every entry in `PROVIDER_TYPES` — credential precedence, `FeatureSet` completeness, `validateConfig` behavior, dry-run mutation safety. Exists because per-provider test files only ever asserted things about themselves, so two providers satisfying the interface differently both passed; #193 is a concrete instance of that failure mode this suite is mutation-verified to catch. A new provider gets most of it for free (see `adding-a-provider.md`).
- **Shared Middleware**: `withCredentials()` handles config loading, provider detection, credential resolution, and error handling for all commands
- **Centralized Error Handling**: `handleCommandError()` provides consistent error formatting; `DoormanError` for structured errors with codes
- **Config Loading Modes**: `getConfig()` accepts explicit modes (`'required'`, `'optional'`, `'raw'`, `'lenient'`) instead of boolean flags
- **Service Layer**: Separate services for Vercel API, validation, and firewall operations
- **Command Pattern**: Each CLI command is a separate module with consistent interface
- **Schema-First**: Zod schemas drive both validation and TypeScript types
- **Retry Logic**: Built-in retry mechanisms for API operations
- **Configuration Discovery**: Automatic config file finding with find-up
- **Rule Translation**: Bidirectional translation between each provider's format and the unified format. `RuleTranslator` (`src/lib/translators/RuleTranslator.ts`) is a thin facade over per-provider modules (`src/lib/providers/vercel/translator.ts`, `.../cloudflare/translator.ts`, #196) — a new provider adds its own `translator.ts` rather than editing a shared file. `RuleTranslator.vercelToCloudflare`/`cloudflareToVercel` (direct provider-to-provider translation, bypassing the unified model) were removed as dead code in #196 — doorman has always routed through `UnifiedConfig` since that model landed, never provider-to-provider directly.
- **Provider-Aware Validation**: `ValidationService.validateConfig()` and `validate.ts` route to either the legacy Vercel AJV/Zod schema or `unifiedConfigSchema`, based on `hasProviderMetadata()` (presence of a `provider`/`providers` field on the config). An `additionalProperties`/`Unknown property` validation failure doesn't necessarily mean the config is invalid — it can mean the wrong schema got selected for a multi-provider config.
- **Sanitize before validating/saving live API responses**: Vercel's real API attaches fields the schema doesn't allow (`additionalProperties: false`) — `id`/`crs`/`projectKey`/`ownerId` at the config level, `valid`/`validationErrors` on every rule. Any code that builds a config to validate or persist from a live `fetchFirewallConfig()` response must strip these first (see `download.ts`'s `rules.map(({ valid, validationErrors, ...rule }) => rule)` pattern, and `backup.ts`'s `sanitizedConfig`). This bug class has recurred multiple times (#108/#112) — when adding new code that touches a raw provider API response, sanitize proactively rather than waiting for it to surface again.

## Branching & Release Strategy

- **`main`**: Stable releases (e.g., `1.5.11`). Pushes trigger semantic-release → npm publish.
- **`beta`**: Prerelease channel (e.g., `1.6.0-beta.1`). Pushes trigger semantic-release → npm publish with `beta` dist-tag. Install with `npm install @gfargo/doorman@beta`.
- **Feature branches**: Branch from target (`main` or `beta`), PR back.
- **Commit prefixes control version bumps**:
  - `feat:` → minor bump (1.5.x → 1.6.0)
  - `fix:` → patch bump (1.5.7 → 1.5.8)
  - `feat!:` or `BREAKING CHANGE:` footer → major bump (1.x → 2.0.0)
  - `chore:`, `docs:`, `ci:`, `test:` → no release
- **Beta → Stable**: Merge `beta` into `main` to promote.
- **CI/CD**: GitHub Actions workflow (`.github/workflows/release.yml`) runs on both `main` and `beta`.
- **Husky hooks**: Disabled during semantic-release commits via `HUSKY=0` env var in CI.

## Terminal & CLI Workflow

- The terminal paste buffer overflows easily with long text. For long content (PR bodies, commit messages, issue bodies, multi-line scripts), write to a temp file and pipe it in rather than passing inline. Example: `gh issue create --body-file ./tmp/issue.md` instead of `--body "...long text..."`.
- Same applies to `gh pr create`, `git commit`, and any command accepting large text arguments.
- Commit subject lines are commitlint-enforced: ≤100 characters, and must not read as sentence-case/start-case (the first word after `type: ` must be lowercase). `fix: Cloudflare warnings, injection, and coverage` fails; `fix: close Wirefilter injection, fix Cloudflare warning handling` passes. A capitalized proper noun later in the subject (e.g. "Cloudflare", "Wirefilter") is fine — it's specifically the leading word that trips the check.
- `gh pr merge --delete-branch` can report a local git error ("main already checked out") when run inside a git worktree where `main` is checked out in a sibling worktree. By that point the merge has already succeeded server-side — confirm with `gh pr view <n> --json state,mergedAt` rather than trusting the command's exit code, then clean up the branch manually (`git push origin --delete <branch>`, `git branch -D <branch>`).
- After a squash-merge, `git merge-base --is-ancestor <feature-branch-commit> origin/main` returns false even though the change landed — squash merges create a new commit with a different hash than any commit on the feature branch. To verify a squash-merged PR's changes are actually live, diff file content against `origin/main` instead (`git show origin/main:<path> | grep ...` or `git diff origin/main -- <path>`).
- After merging and deleting a branch (locally and on the remote), starting the *next* piece of work with a plain `git checkout -B <new-name> origin/main` from a shell still sitting on the just-merged local branch is safe (it force-resets to the new base) — but committing new work directly onto that stale local branch name first, intending to rename/rebase later, is not: the branch's local history still points at its pre-squash commits, not the squashed one now on `origin/main`. If this happens, fix it before pushing: `git branch -f <new-branch-name> <new-commit-sha>`, `git checkout -B <new-branch-name> origin/main`, `git cherry-pick <new-commit-sha>`, then delete the stale local branch. Simplest habit: always start new work with an explicit `git checkout -B <name> origin/main` (or `git fetch` first) rather than continuing on whatever branch the shell happens to be on.

## Testing Gotchas

- **Always mock `process.exit`** in any command-handler test that can hit an error path: `jest.spyOn(process, 'exit').mockImplementation(((code) => { throw new Error(\`process.exit called with "${code}"\`) }) as any)` in `beforeEach`, with `jest.restoreAllMocks()` in `afterEach`. `handleCommandError()` always ends in `process.exit(1)`; without an explicit mock this can manifest as a confusing top-level test-suite failure instead of a catchable promise rejection.
- **Never partially mock the logger.** A logger mock missing a method (e.g. `debug`, `verbose`) throws a `TypeError` deep inside `withCredentials()`/`ProviderDetector` that gets silently caught and reported by `handleCommandError()` as a generic, unhelpful failure — easy to misdiagnose as a real application bug rather than an incomplete mock. Use the shared `createLoggerMock()` from `src/tests/testHelpers/loggerMock.ts`, which stubs every consola method the codebase actually calls.
- **Always pass an explicit `--config` path pointing to a real file** in command-handler tests, even for commands that never read the config themselves. `withCredentials()` unconditionally calls `getConfig()` as its first step; with no path, `ConfigFinder.findConfig()` does a dynamic `import('find-up')` (ESM-only) that breaks under ts-jest's CJS transform.
- **When mocking `CloudflareClient` for a command-level test**, mock `getOptimizer()` to return a real `new CloudflareOptimizer()` instance, not a stub — `CloudflareFirewallService.getChanges()`/`syncRules()` depend on its real diffing logic. Use the shared `mockCloudflareClientPrototype()` helper in `src/tests/testHelpers/providerMocks.ts` rather than re-deriving this.
- **Use non-empty fixtures when testing API-response sanitization.** A test fixture with `rules: []` can't catch a missing per-rule field-strip (see the sanitize-before-validating note above) — use at least one realistic, non-empty rule/IP entry when the thing under test is about stripping fields from live API data.
- **TS assertion functions** (`asserts x is T`, e.g. `ValidationService.validateConfig`) can only be called through a variable with an *explicit* type annotation: `const v: ValidationService = ValidationService.getInstance(); v.validateConfig(x)`. Calling `ValidationService.getInstance().validateConfig(x)` inline fails to compile (TS2775/TS2776) — this applies whenever calling an assertion-typed method off a freshly-returned instance rather than a pre-declared variable.
- **`jest.spyOn` cannot redefine `fs`'s exports** (`TypeError: Cannot redefine property`) — Node's `fs` module exports aren't configurable. To make one `fs` function fail in a specific test (e.g. testing an atomic-write failure path), use `jest.mock('fs', () => ({ ...jest.requireActual('fs'), writeFileSync: jest.fn((...args) => jest.requireActual('fs').writeFileSync(...args)), ... }))` — delegating to the real implementation by default so only the specific call under test needs `.mockImplementation(...)` overridden.
- **Mutation-verify a new regression/conformance test before trusting it**, don't just watch it pass: temporarily revert the fix (or invert the specific behavior it claims to protect) in the source, confirm the test fails with a legible message, then restore the fix and confirm it passes again. A test written only against the fixed behavior can pass "by construction" without actually exercising the bug it's meant to guard — this caught real gaps during the August 2026 provider-groundwork pass (e.g. confirming the #197 conformance suite's credential case genuinely fails against the pre-#193 code, not just after it).
