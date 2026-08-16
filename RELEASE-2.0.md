# Doorman 2.0 — Multi-Provider WAF Automation

## Headline

Doorman 2.0 ships Cloudflare WAF support, a new `.doorman.json` config format, and 1,100+ tests backing a production-ready multi-provider firewall management CLI.

---

## What's New

### Cloudflare WAF Support

Doorman now manages Cloudflare WAF rules alongside Vercel Firewall from the same CLI. One tool, two providers, same workflow.

- Full CRUD for Cloudflare Rulesets and Rules
- Lists API integration for efficient bulk IP blocking
- Automatic rule translation between Vercel and Cloudflare formats
- Provider-aware validation, health scoring, and error handling
- Credential verification and setup guidance

```bash
# Target Cloudflare with any command
doorman sync --provider cloudflare
doorman list --provider cloudflare
doorman status --provider cloudflare
```

### New Config Format: `.doorman.json`

The default config filename is now `.doorman.json` — shorter, provider-agnostic, and matches the project name. Existing `vercel-firewall.config.json` files are still auto-detected and work without changes.

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "provider": "cloudflare",
  "providers": {
    "cloudflare": {
      "zoneId": "your_zone_id",
      "accountId": "your_account_id"
    }
  },
  "rules": [],
  "ips": []
}
```

### Provider Abstraction Layer

A unified `IFirewallProvider` interface means every command works identically across providers. Provider is auto-detected from your config, environment variables, or the `--provider` flag.

Detection priority:

1. `--provider` CLI flag
2. `provider` field in config
3. Provider-specific config keys
4. Environment variables (`DOORMAN_PROVIDER`, `CLOUDFLARE_ZONE_ID`, `VERCEL_PROJECT_ID`)
5. Default: Vercel

### Rule Translation Engine

Bidirectional translation between Vercel and Cloudflare rule formats with:

- Expression builder for Cloudflare wirefilter syntax
- Field mapping between provider-specific field names
- Translation warnings for lossy conversions (e.g., regex on non-Enterprise Cloudflare plans)
- Confidence scoring for translation accuracy

### Structured Error Handling

Every error now includes an error code, actionable suggestion, and documentation link:

```
[PROV_5000] Authentication failed for cloudflare

Suggestion: Verify your CLOUDFLARE_API_TOKEN is valid and not expired.
            Create a new token at dash.cloudflare.com/profile/api-tokens

Documentation: https://doorman.griffen.codes/docs/cloudflare-setup
```

### Performance & Reliability

- API response caching with TTL-based invalidation
- Request deduplication for concurrent operations
- Exponential backoff with jitter for retries
- Batch processing for large rule sets
- Graceful shutdown with progress preservation

---

## By the Numbers

| Metric              | v1.5       | v2.0                    |
| ------------------- | ---------- | ----------------------- |
| Providers supported | 1 (Vercel) | 2 (Vercel + Cloudflare) |
| Test suites         | 26         | 55                      |
| Tests passing       | 410        | 1,132                   |
| Source files (new)  | —          | 47                      |
| Lines of new code   | —          | ~3,600                  |
| TypeScript errors   | 0          | 0                       |

---

## Upgrade Path

For existing users — nothing breaks:

```bash
npm install -g @gfargo/doorman@latest
```

- Same commands, same config, same env vars
- Provider defaults to Vercel when not specified
- Existing `vercel-firewall.config.json` files work unchanged
- New projects get `.doorman.json` by default

To start using Cloudflare:

```bash
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ZONE_ID="..."
doorman init --provider cloudflare --interactive
```

---

## Architecture Highlights

### Provider Interface

```
Commands → withCredentials() middleware
    ↓
Provider Detection (config → env → flag → default)
    ↓
IFirewallProvider interface
    ├── VercelProvider → VercelFirewallService → VercelClient
    └── CloudflareProvider → CloudflareFirewallService → CloudflareClient
        ↓
    Base Classes (retry, caching, rate limiting)
```

### Translation Pipeline

```
Vercel Rule ←→ Unified Rule ←→ Cloudflare Rule
                    ↕
         ExpressionBuilder (wirefilter syntax)
         FieldMapper (field name translation)
         TranslationWarningSystem (lossy conversion alerts)
```

---

## What's Next

Phase 6 is spec'd and ready for implementation:

- `doorman migrate --from vercel --to cloudflare` — automated cross-provider migration with backup, rollback, and reporting
- Official GitHub Action for CI/CD automation
- Advanced expression parser for complex Cloudflare wirefilter expressions

---

## Links

- [Documentation](https://doorman.griffen.codes/docs)
- [GitHub](https://github.com/gfargo/doorman)
- [npm](https://www.npmjs.com/package/@gfargo/doorman)
- [GitHub Wiki](https://github.com/gfargo/doorman/wiki)
- [Cloudflare Setup Guide](https://github.com/gfargo/doorman/wiki/Cloudflare-Setup)

---

## Install

```bash
npm install -g @gfargo/doorman
doorman setup
```
