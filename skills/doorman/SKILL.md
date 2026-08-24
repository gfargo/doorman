---
name: doorman
description: Manage Vercel, Cloudflare, and Fastly WAF firewall rules as code with the Doorman CLI. Use for any firewall-as-code task — creating rules, IP blocking, rate limiting, bot protection, geo-blocking, syncing local config to providers, validating configurations, exporting documentation, CI/CD automation, or translating rules between provider formats.
license: MIT
compatibility: Node.js >= 20. Requires provider API tokens (VERCEL_TOKEN, CLOUDFLARE_API_TOKEN, or FASTLY_API_TOKEN). Install globally via npm install -g @gfargo/doorman.
metadata:
  author: gfargo
  version: '1.0'
  homepage: https://github.com/gfargo/doorman
  npm: '@gfargo/doorman'
---

# Doorman — Firewall Rules as Code

Doorman is a CLI for managing WAF (Web Application Firewall) rules as code across Vercel, Cloudflare, and Fastly Next-Gen WAF. Configuration lives in `.doorman.json`, syncs bidirectionally with provider APIs, and integrates into CI/CD pipelines.

## Command Quick Reference

```bash
# Setup & Init
doorman setup                       # Show setup guide with links
doorman init --interactive          # Create new config interactively
doorman init security-focused       # Start with security templates

# Rule Creation
doorman add --interactive           # Guided rule creation
doorman add --name "Block" --field path --op pre --value "/admin" --action deny
doorman template ai-bots            # Add pre-built template

# Status & Inspection
doorman status                      # Sync status + health score
doorman list                        # Show deployed rules (table/json)
doorman diff                        # Local vs remote differences

# Sync & Deploy
doorman validate                    # Check config syntax + health
doorman sync                        # Deploy local config to provider
doorman download                    # Pull remote rules to local config

# Advanced
doorman watch                       # Auto-sync on file changes
doorman backup                      # Create/restore config backups
doorman export --format markdown    # Export as markdown|json|yaml|terraform
doorman remove --name "Old Rule"    # Remove rules by name/ID
```

All commands accept `--provider vercel|cloudflare|fastly` and `--config <path>`.

## Environment Variables

```bash
# Vercel (default provider)
VERCEL_TOKEN=your_token
VERCEL_PROJECT_ID=prj_xxx
VERCEL_TEAM_ID=team_xxx

# Cloudflare (beta)
CLOUDFLARE_API_TOKEN=your_token
CLOUDFLARE_ZONE_ID=zone_xxx
CLOUDFLARE_ACCOUNT_ID=acc_xxx   # optional, enables Lists API for bulk IP management

# Fastly Next-Gen WAF (beta)
FASTLY_API_TOKEN=your_token
FASTLY_WORKSPACE_ID=workspace_xxx
```

## Config Structure

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "projectId": "prj_xxx",
  "teamId": "team_xxx",
  "rules": [],
  "ips": []
}
```

For Cloudflare or Fastly, add `provider` and `providers` fields instead of `projectId`/`teamId` — and note this switches the *rule* shape too, not just the top-level fields. See [Rule Shape](#rule-shape-minimal) below.

## Core Workflow

```bash
# Edit .doorman.json (add/modify rules), then:
doorman validate && doorman diff && doorman sync

# Pull existing rules from a live provider:
doorman download

# Safe production deployment:
doorman backup && doorman validate && doorman diff && doorman sync && doorman status
```

## Rule Shape (Minimal)

Two different rule shapes, picked by whether the config has `provider`/`providers` set (see [Config Structure](#config-structure) above) — **they are not interchangeable, and mixing them fails validation.**

**Legacy shape** (no `provider`/`providers` — Vercel-only):

```json
{
  "name": "Block Admin",
  "active": true,
  "conditionGroup": [{ "conditions": [{ "type": "path", "op": "pre", "value": "/admin" }] }],
  "action": { "mitigate": { "action": "deny" } }
}
```

**Logic**: Conditions within a group are AND'd. Multiple groups are OR'd.

**Condition types**: `path`, `method`, `host`, `user_agent`, `ip_address`, `header`, `query`, `cookie`, `geo_country`, `geo_city`, `geo_continent`, `geo_country_region`, `geo_as_number`, `scheme`, `protocol`

**Operators**: `eq`, `pre` (prefix), `suf` (suffix), `sub` (contains), `inc` (in array), `re` (regex), `ex` (exists), `nex` (not exists)

**Actions**: `deny`, `challenge`, `rate_limit`, `redirect`, `log`, `bypass` (no `allow`/`block`)

**Unified shape** (`provider`/`providers` set — required for Cloudflare/Fastly):

```json
{
  "name": "Block Admin",
  "enabled": true,
  "conditions": [{ "field": "path", "operator": "starts_with", "value": "/admin" }],
  "action": { "type": "deny" }
}
```

**Logic**: conditions default to AND across all of them. Tag conditions with a `group` number for OR-of-AND-groups (same conditions sharing a `group` are AND'd, distinct `group`s are OR'd) — see [references/rules.md](references/rules.md) for the full explanation and an example.

**Condition fields**: `ip`, `country`, `region`, `city`, `asn`, `path`, `host`, `method`, `header`, `query`, `cookie`, `user_agent`, `referer`, `scheme`, `port` — support varies by provider, see [references/cloudflare.md](references/cloudflare.md)/[references/fastly.md](references/fastly.md)

**Operators**: `eq`, `ne`, `contains`, `not_contains`, `starts_with`, `ends_with`, `matches`, `in`, `not_in`, `gt`, `ge`, `lt`, `le`, `exists`, `not_exists` — **on Vercel specifically, `ne`/`not_contains`/`not_in`/`gt`/`ge`/`lt`/`le` currently degrade silently to `eq` (known bug, [doorman#261](https://github.com/gfargo/doorman/issues/261)) — avoid them in a Vercel-targeted config until that's fixed.**

**Actions**: `log`, `deny`, `challenge`, `bypass`, `rate_limit`, `redirect`, `allow`, `block` — **`allow`/`block` are invalid on Vercel specifically ([doorman#262](https://github.com/gfargo/doorman/issues/262)); use `bypass`/`deny` there instead.**

## When to Read Each Reference

Load the relevant reference file for detailed documentation:

| Task                                                                                        | Reference                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Writing rules — full field docs, operators, actions, IP blocking, patterns                  | [references/rules.md](references/rules.md)           |
| Cloudflare-specific setup, Lists API, managed rule groups, expression translation, limitations | [references/cloudflare.md](references/cloudflare.md) |
| Fastly-specific setup, condition/action mapping, rate-limit signal requirement, limitations | [references/fastly.md](references/fastly.md)         |
| Available templates and what they protect against                                           | [references/templates.md](references/templates.md)   |
| CI/CD integration, automation, export formats, validation in pipelines                      | [references/cicd.md](references/cicd.md)             |

## Principles

1. **Validate before syncing** — always run `doorman validate` before `doorman sync`.
2. **Diff before deploying** — use `doorman diff` to preview what will change on the provider.
3. **Backup before major changes** — `doorman backup` creates a timestamped snapshot.
4. **Config is the source of truth** — make changes in `.doorman.json`, let sync propagate them.
5. **Use templates for common patterns** — `doorman template` has battle-tested rules for bots, geo-blocking, and attack paths.
6. **Health score matters** — add descriptions, use IDs with `rule_` prefix, avoid regex when simpler operators work.
