# Implementation Plan

## Phase 1: Pre-Migration Prep

- [x] 1. Confirm npm name availability
  - Verify `@gfargo/doorman` is available on npm
  - Confirm `gfargo/doorman` GitHub repo name is available or plan redirect
  - _Requirements: 1.1, 1.3_

- [x] 2. Create migration branch
  - Create `feat/rename-to-doorman` branch from `main`
  - _Requirements: 4.1_

## Phase 2: Code & Config Changes

> Status: COMPLETE. All items done on branch `feat/rename-to-doorman`. Build passes, 1154 tests pass.

- [x] 3. Update package.json identity
  - Change `name` from `vercel-doorman` to `@gfargo/doorman`
  - Add `doorman` as primary binary, keep `vercel-doorman` as deprecated shim
  - Update `repository.url`, `homepage`, `bugs.url`
  - Update `description` and `keywords` to remove Vercel-specific branding
  - _Requirements: 1.1, 1.2, 2.1_

- [x] 4. Update source code references
  - Update CLI banner and yargs `.scriptName()` in `bin/run.ts`
  - Update command help text and error messages across `src/commands/`
  - Update logger tags and error prefixes in `src/lib/`
  - Create deprecated binary wrapper at `bin/run-deprecated`
  - Keep `vercel-firewall.config.json` as legacy fallback with deprecation warning
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 4.1_

- [x] 5. Update schema and constants
  - Update JSON Schema `$id` and `title` fields in `schema/`
  - Update `src/constants/schema.ts` hardcoded name strings
  - Regenerate JSON Schema output files
  - _Requirements: 4.2_

- [x] 6. Update documentation
  - Rewrite README.md title, badges, and install commands
  - Update AGENTS.md and CLAUDE.md references
  - Update `.wiki/` pages with new package name
  - Update `examples/` comments and descriptions
  - Update `.kiro/steering/` files
  - _Requirements: 4.1, 4.2_

- [x] 7. Update build and tooling configs
  - Verify `.releaserc.json` works with new package name
  - Verify GitHub Actions workflow references are correct
  - Create deprecated bin wrapper script
  - _Requirements: 5.2, 2.1_

## Phase 3: Repository Migration

- [ ] 8. Rename GitHub repository
  - Rename `gfargo/vercel-doorman` to `gfargo/doorman` via GitHub Settings
  - Update local clones: `git remote set-url origin git@github.com:gfargo/doorman.git`
  - Verify GitHub auto-redirect works from old URL
  - _Requirements: 5.1, 5.3_

- [ ] 9. Update GitHub Wiki remote
  - Update remote URL in `.wiki/.git/config` to new repo
  - Verify wiki pages still render correctly
  - _Requirements: 4.1, 5.1_

- [ ] 10. Verify repository settings post-rename
  - Confirm branch protections still apply
  - Confirm secrets (NPM_TOKEN, etc.) remain intact
  - Confirm GitHub Actions workflows trigger correctly
  - _Requirements: 5.1, 5.2_

## Phase 4: npm Publishing

- [ ] 11. Merge feature branch and publish
  - Merge `feat/rename-to-doorman` → `main` with `feat!: rename package from vercel-doorman to @gfargo/doorman`
  - Semantic-release publishes `@gfargo/doorman` (major version bump)
  - Verify publish: `npm info @gfargo/doorman`
  - _Requirements: 1.1, 1.3, 6.1, 6.2_

- [ ] 12. Deprecate old npm package
  - Run: `npm deprecate vercel-doorman "This package has been renamed to @gfargo/doorman. Install with: npm i -g @gfargo/doorman"`
  - Verify deprecated binary works: `npx vercel-doorman --help` shows warning + delegates
  - _Requirements: 1.4, 2.1, 2.3_

## Phase 5: Ecosystem Updates

- [ ] 13. Update website
  - Update `.www/` site title, meta tags, OG image
  - Update install commands on landing/getting-started pages
  - Update docs links pointing to old repo URL
  - _Requirements: 5.3, 4.1_

- [ ] 14. Update external references
  - Update blog posts and social media references
  - Update npm keywords for discoverability
  - Verify old GitHub URL redirects work
  - _Requirements: 5.3_

## Phase 6: Post-Migration Verification

- [ ] 15. Functional verification
  - `npm install -g @gfargo/doorman && doorman --help` works correctly
  - All commands function: sync, list, download, validate, diff, status, etc.
  - CI/CD publishes correctly on `main` and `beta` branches
  - Config discovery finds `.doorman.json` and legacy `vercel-firewall.config.json`
  - _Requirements: 1.1, 1.2, 3.1, 3.2, 5.2_

## Phase 7: Cleanup (Future)

- [ ] 16. Remove deprecated shims after deprecation window
  - Remove `vercel-doorman` binary entry from `package.json` (after 6 months)
  - Remove legacy `vercel-firewall.config.json` support (target: v3.0)
  - Archive stale external references
  - _Requirements: 2.2, 3.4_
