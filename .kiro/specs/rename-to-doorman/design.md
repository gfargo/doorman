# Design Document

## Overview

This design covers the full migration of the project identity from `vercel-doorman` to `@gfargo/doorman`. The migration is phased to minimize disruption: code changes land first on a feature branch, followed by repository rename, npm publish under the new name, and ecosystem cleanup.

The rename is motivated by Doorman's evolution into a multi-provider tool (Vercel + Cloudflare). Keeping "vercel" in the name creates confusion about scope and limits brand identity.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package name | `@gfargo/doorman` | Scoped under existing npm user, binary stays `doorman` |
| Version bump | Major (breaking) | New install command, new binary name signals a clear migration point |
| Deprecation window | 6 months | Patch-only support on `vercel-doorman`, gives users time to update |
| Dual binary period | 2 releases | `vercel-doorman` prints warning and delegates to `doorman` |
| Config file migration | Warn + read both | Non-breaking; remove legacy `vercel-firewall.config.json` in 3.0 |
| GitHub repo name | `gfargo/doorman` | GitHub auto-redirects from old URL |

## Migration Architecture

### Phase Sequencing

```
Phase 1: Prep          →  Confirm npm availability, create branch
Phase 2: Code Changes  →  Update all source references (branch work)
Phase 3: Repo Rename   →  GitHub Settings rename, update remotes
Phase 4: npm Publish   →  Merge branch → semantic-release → deprecate old
Phase 5: Ecosystem     →  Website, external refs, redirects
Phase 6: Verification  →  End-to-end functional checks
Phase 7: Cleanup       →  Remove legacy shims after deprecation window
```

Phases are sequential — each depends on the previous completing successfully. Phase 2 (code changes) is the bulk of the development work and is done on a feature branch (`feat/rename-to-doorman`) that only merges after Phase 3 (repo rename).

### Dual Binary Strategy

During the transition period, the package ships two binaries:

```json
{
  "bin": {
    "doorman": "./bin/run",
    "vercel-doorman": "./bin/run-deprecated"
  }
}
```

`bin/run-deprecated` is a thin wrapper:
```typescript
#!/usr/bin/env node
console.warn('⚠️  vercel-doorman is deprecated. Use "doorman" instead.')
console.warn('   Install: npm i -g @gfargo/doorman\n')
require('./run')
```

After the deprecation window (6 months / ~2 releases), the `vercel-doorman` entry is removed from `package.json`.

### Config Discovery Order

The config finder checks in this order:
1. `.doorman.json` (primary, new name)
2. `vercel-firewall.config.json` (legacy, with deprecation warning)
3. `vercel-firewall[project-name].config.json` (legacy project-specific)

When a legacy file is found, a one-time warning is printed:
```
⚠️  Found legacy config 'vercel-firewall.config.json'. Please rename to '.doorman.json'.
    Legacy config support will be removed in v3.0.
```

### Source Code Changes Scope

All references to the old name span these categories:

- **CLI identity**: yargs `.scriptName()`, banner text, command help
- **Error messages**: logger tags, error prefixes
- **Schema**: JSON Schema `$id` and `title` fields
- **Documentation**: README, AGENTS.md, CLAUDE.md, wiki pages, examples, steering files
- **Build config**: `.releaserc.json` (package name), workflow files (if repo name is referenced)
- **Website** (`.www/`): site title, meta tags, install commands, docs links

Environment variables (`VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, etc.) are provider-specific and do NOT change — they refer to the provider, not the tool.

### npm Deprecation Strategy

After publishing `@gfargo/doorman`:

```bash
npm deprecate vercel-doorman "This package has been renamed to @gfargo/doorman. Install with: npm i -g @gfargo/doorman"
```

This causes anyone running `npm install vercel-doorman` to see the deprecation notice. The old package remains installable but receives no further updates.

### Rollback Plan

If issues arise after the repo rename or npm publish:

1. **Repo rename**: GitHub supports renaming back; the redirect works both ways
2. **npm publish**: Can unpublish within 72 hours if critical issues found, or publish a patch to the old name pointing to the new one
3. **Code changes**: The feature branch can be reverted with a single merge revert

## Testing Strategy

The rename is validated by:

1. **Build passes** on the feature branch (confirmed: 1154 tests pass)
2. **All commands functional** after the rename — no broken imports or references
3. **Config discovery** still finds both `.doorman.json` and legacy files
4. **Binary resolution** works for both `doorman` and `vercel-doorman` (deprecated shim)
5. **CI/CD** publishes correctly under the new name on `main` and `beta`

## Security Considerations

- npm token and GitHub secrets remain unchanged (they're account-level, not package-name-level)
- No new environment variables introduced
- The deprecated binary delegates immediately — no dual execution paths that could diverge

## Execution Order

```
1. Rename GitHub repo (Phase 3.1)
2. Update wiki remote (Phase 3.2)
3. Verify repo settings (Phase 3.3)
4. Merge feat/rename-to-doorman → main (Phase 4.1)
5. Verify npm publish (Phase 4.2)
6. Deprecate old package (Phase 4.3)
7. Merge website PR (Phase 5.1)
8. Update external refs (Phase 5.2)
9. End-to-end verification (Phase 6)
```
