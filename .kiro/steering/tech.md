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
pnpm test               # Run full test suite (55 suites, 1100+ tests)
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
- **Provider Abstraction**: `IFirewallProvider` interface with `ProviderRegistry` for multi-provider support (Vercel stable, Cloudflare beta)
- **Shared Middleware**: `withCredentials()` handles config loading, provider detection, credential resolution, and error handling for all commands
- **Centralized Error Handling**: `handleCommandError()` provides consistent error formatting; `DoormanError` for structured errors with codes
- **Config Loading Modes**: `getConfig()` accepts explicit modes (`'required'`, `'optional'`, `'raw'`, `'lenient'`) instead of boolean flags
- **Service Layer**: Separate services for Vercel API, validation, and firewall operations
- **Command Pattern**: Each CLI command is a separate module with consistent interface
- **Schema-First**: Zod schemas drive both validation and TypeScript types
- **Retry Logic**: Built-in retry mechanisms for API operations
- **Configuration Discovery**: Automatic config file finding with find-up
- **Rule Translation**: Bidirectional translation between Vercel and Cloudflare formats via `RuleTranslator`

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
