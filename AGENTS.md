# Repository Guidelines

> Detailed documentation lives in `.kiro/steering/`. This file serves as a quick-reference hub
> and covers guidelines not found in those docs.

## Quick Reference (pointers to detailed docs)

| Topic | Steering Doc |
| ----- | ------------ |
| Product overview, supported providers, target users | [`.kiro/steering/product.md`](.kiro/steering/product.md) |
| Project structure, module organization, file layout | [`.kiro/steering/structure.md`](.kiro/steering/structure.md) |
| Tech stack, build/test/lint commands, architecture patterns | [`.kiro/steering/tech.md`](.kiro/steering/tech.md) |
| Branching & release strategy, CI/CD | [`.kiro/steering/tech.md`](.kiro/steering/tech.md) |
| Wiki-powered docs site workflow | [`.kiro/steering/wiki-docs.md`](.kiro/steering/wiki-docs.md) |

---

## Coding Best Practices

These supplement the style/architecture info in the steering docs:

- Use the `consola` logger instead of `console.log`.
- Use `handleCommandError()` in every command's catch block for consistent error output.
- Use `DoormanError` for structured errors with codes and actionable suggestions.
- Use `withCredentials()` middleware for any command that needs provider/credentials.
- Use `getConfig()` with explicit mode strings (`'required'`, `'optional'`, `'raw'`, `'lenient'`).
- Mock `process.exit` in tests to prevent Jest worker crashes.
- Handle API errors and rate limits; use the retry utility for resilience.

## Testing Guidelines

Extends the testing info in `.kiro/steering/tech.md`:

- **Framework**: Jest + ts-jest (Node environment).
- **Location**: Co-locate as `*.test.ts` or place in `src/tests/`.
- **Mocks**: Place under `src/tests/__mocks__/` (e.g., `chalk.ts`).
- **Single test**: `pnpm test -- src/tests/validation.test.ts` or `pnpm test -- -t "test name pattern"`.
- **Skipped tests**: Some Cloudflare provider tests temporarily skipped in `jest.config.js` (timeout/mock issues).
- **CI/CD**: Tests run on every push to `main` and `beta` via GitHub Actions.

## Commit & Pull Request Guidelines

- Commits: Conventional Commits enforced by commitlint. Use `pnpm commit` (commitizen) for prompts.
- PRs: small, focused. Include summary, linked issues, and CLI output or screenshots when relevant.
- Use `--no-verify` sparingly — the pre-commit hook catches lint/format/test issues.

## Security & Configuration

- Auth: CLI reads env via `dotenv` and flags.
- **Vercel** env vars: `VERCEL_TOKEN` (required), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`.
- **Cloudflare** env vars: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID` (optional).
- Do not commit secrets. Keep `dist/` and `.env*` out of VCS (already ignored).
- **Audit level**: Moderate severity threshold in CI (`pnpm audit --audit-level=moderate`).
- Use pnpm overrides in `package.json` for vulnerable transitive deps.

## CLI Commands (quick list)

All commands accept `--provider vercel|cloudflare` (auto-detected if omitted), `--debug`, and `--ci` flags.

`list` · `sync` · `download` · `template` · `validate` · `status` · `diff` · `watch` · `backup` · `export` · `init` · `setup`

See `.kiro/steering/structure.md` for per-command file mappings.
