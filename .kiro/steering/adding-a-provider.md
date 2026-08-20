# Adding a New Provider

Checklist and context for implementing a new `IFirewallProvider` (Fastly — #186, GCP Cloud Armor — #187, AWS WAFv2 — #188). Written after a groundwork pass (#181/#182/#196/#197, August 2026) specifically restructured the provider layer so this list is short — before that pass, adding a provider meant editing ~12 shared files instead of adding a handful of new ones.

## What a new provider touches

1. **`PROVIDER_TYPES`** in `src/lib/providers/IFirewallProvider.ts` — add the provider's string literal. Everything else that needs a runtime list of providers (CLI `--provider` choices, `ProviderDetector.isValidProvider`, the interactive picker in `providerHelper.ts`) derives from this automatically. Nothing else to edit for the provider-list surface.
2. **The provider's own directory**, `src/lib/providers/<name>/`, containing:
   - `<Name>Client.ts` — HTTP client. Extend `BaseFirewallClient` (`src/lib/providers/BaseFirewallClient.ts`) _only if the provider is REST-with-header-auth_ — it's built directly on `fetch`/`RequestInit`. If the provider needs something structurally different (an SDK, request signing, a non-HTTP transport — this is expected for AWS's SigV4-signed SDK client), don't force the fit; implement the client however that provider's real API demands, and satisfy `IFirewallProvider` at the service layer instead. See #198 for the reasoning — composable utility functions (retry/backoff, and eventually optimistic-concurrency-retry) are the intended cross-cutting mechanism, not a deeper inheritance chain forcing every provider through one base class.
   - `<Name>FirewallService.ts` — implements `IFirewallProvider`. Extend `BaseFirewallService` for the shared `validateConfig()`/`getHealthScore()`/`diffRules()`/`diffIPs()` scaffolding (both current providers do; it's provider-agnostic and has no REST assumptions baked in, unlike `BaseFirewallClient`).
   - `<Name>Provider.ts` — static factory (`create()`, `fromEnv()`, `fromConfig()`), mirroring `VercelProvider.ts`/`CloudflareProvider.ts`.
   - `credentials.ts` — a `CredentialDescriptor` (see `src/lib/providers/credentials.ts` for the type, `vercel/credentials.ts`/`cloudflare/credentials.ts` for examples) declaring each credential's flag key, env var, label, required/secret flags, and — for non-secret values — its `configKey` so it can live in `providers.<name>` in a config file. Register it in `CREDENTIAL_DESCRIPTORS` in `src/lib/providers/credentials.ts`.
   - `translator.ts` — `<name>ToUnified()`/`unifiedTo<Name>()` functions (see `vercel/translator.ts`/`cloudflare/translator.ts`). Add corresponding static methods to the `RuleTranslator` facade (`src/lib/translators/RuleTranslator.ts`) if other code should call them via that facade, matching the existing pattern.
3. **`initProviders.ts`** — register the provider's factory with `ProviderRegistry`, same shape as the existing `vercel`/`cloudflare` registrations.
4. **`getProviderDisplayName()`** in `providerHelper.ts` — add the human-readable name (e.g. `'Fastly Next-Gen WAF'`).
5. **The conformance suite**, `src/lib/providers/__tests__/conformance.test.ts` (#197) — most of it (credential precedence, `FeatureSet` completeness, `validateConfig` rejecting a rules-less config) covers a new provider automatically once steps 1–2 are done, with zero edits to the suite itself. Two things need one addition each:
   - a `CREDENTIAL_CONFORMANCE_CASES` entry (the provider's config shape, for the "config-declared credentials resolve without needing env vars" case)
   - a `dryRun` `it(...)` block (needs the provider's own client-mocking setup — see the existing Vercel/Cloudflare blocks for the pattern; reuse `src/tests/testHelpers/providerMocks.ts`-style mock helpers rather than mocking `fetch` directly)

## Known model gaps that may bite a new provider

These are already tracked; check whether the provider you're building actually hits them before treating them as blocking:

- **#184 — condition trees are flat, not recursive.** `UnifiedCondition` supports one level of AND-within-group/OR-across-groups (via the `group` index). AWS WAFv2's rule statements are genuinely recursive AND/OR/NOT trees — this is likely to actually block a faithful AWS translation, not just be a nice-to-have. Fastly and GCP Cloud Armor are more likely fine with the current flat model; verify against their real condition/statement shape before assuming either way.
- **#185 — single-resource targeting assumed.** `UnifiedConfig` models one provider config as attaching to one target. AWS WAFv2 WebACLs and GCP Cloud Armor policies can both attach to multiple resources.
- **#183 — no managed-rule-group config surface.** `FeatureSet.supportsManagedRules` is declared but reserved (see #180) — implementing it is its own scoped piece of work, not assumed to ride along with a new provider.

## Known bugs worth knowing about (not blocking, but relevant context)

- **#199 — `unifiedToCloudflare` doesn't build redirect `action_parameters`.** Found while splitting the translator (#196): a dead, unreachable function (`vercelToCloudflare`, since removed) had correct redirect-handling logic that the live path never got. If a new provider's translator is modeled by copying an existing one, copy from the _live_ path (`cloudflareToUnified`/`unifiedToCloudflare` as they exist post-#196), not from git history or from a function that looks similar but isn't actually exercised.

## Verification methodology used throughout the groundwork pass

Worth carrying forward for a new provider's tests, not just repeating by habit:

- **Mutation-verify new regression tests before trusting them.** Don't just add a test and watch it pass — locally revert the fix (or invert the specific behavior the test claims to guard), confirm the test _fails_ with a clear message, then restore the fix and confirm it passes again. Several real gaps this pass found (the Cloudflare credential-resolution bug fixed in #193, the non-atomic config write fixed in [PR #194](https://github.com/gfargo/doorman/pull/194)) were caught specifically because this step was done, not skipped.
- **Verify end-to-end against `demos/mock-server.mjs`, not just unit tests**, for anything that changes what actually gets sent over the wire (`DOORMAN_VERCEL_API_BASE_URL` points the real CLI at it). Unit-level mocks can pass while the real command-level flow is still broken.
- **Check whether a "generalize this per-provider test" issue's suggested invariants actually hold for both existing providers before writing them into a shared suite.** #197's initial invariant list included "partial `syncRules` failure surfaces via `errors[]`" — checking it against real code first found Vercel's write model is per-rule (independently failable) while Cloudflare's is a single atomic ruleset replace with no comparable partial-failure shape. Forcing a uniform assertion would have either silently skipped Cloudflare or mischaracterized its write model; better to land what's honestly true today and grow the suite as more providers clarify what's actually universal.
