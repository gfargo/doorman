# Cloudflare Provider Reference

Cloudflare WAF support in Doorman (beta). Manage Cloudflare custom rulesets and IP Lists through the same config-as-code workflow.

## Setup

### Environment Variables

```bash
CLOUDFLARE_API_TOKEN=your_token    # Required — API token with Zone.Firewall permissions
CLOUDFLARE_ZONE_ID=zone_xxx        # Required — zone to manage rules for
CLOUDFLARE_ACCOUNT_ID=acc_xxx      # Optional — enables Lists API for bulk IP management
```

### API Token Permissions

Create a Custom Token at https://dash.cloudflare.com/profile/api-tokens with:

- **Zone > Firewall Services > Edit** — for custom rulesets
- **Account > Account Filter Lists > Edit** — for Lists API (bulk IP management, requires `CLOUDFLARE_ACCOUNT_ID`)

### Config Shape

Multi-provider config with explicit provider declaration:

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

Or pass `--provider cloudflare` to any provider-aware command (`sync`, `diff`, `download`, `list`, `status`, `watch`, `backup`, `export`) to override auto-detection.

## Usage

`doorman init` only supports Vercel today — it has no `--provider` flag and doesn't prompt for Cloudflare credentials. Create `.doorman.json` by hand using the config shape above, then:

```bash
doorman validate                            # Validate — auto-detects Cloudflare from the config's `provider` field
doorman sync --provider cloudflare          # Deploy to Cloudflare
doorman download --provider cloudflare      # Pull rules from Cloudflare
doorman diff --provider cloudflare          # Compare local vs live
doorman list --provider cloudflare          # Show deployed rules
```

## Rule Translation

Doorman translates its unified rule format (`conditions`/`enabled`/`action: {type}` — different from the legacy shape [rules.md](rules.md) documents) into Cloudflare Wirefilter expressions automatically. The translation is bidirectional — `doorman download` pulls Cloudflare expressions back into the unified format. Cloudflare requires the unified format — a config with `provider: "cloudflare"` cannot use the legacy `conditionGroup`/`mitigate` shape.

### Field Mapping

Cloudflare supports all 16 unified condition fields:

| Doorman Field  | Cloudflare Field                                                                        | Notes                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ip`           | `ip.src`                                                                                |                                                                                                                               |
| `country`      | `ip.geoip.country`                                                                      |                                                                                                                               |
| `region`       | `ip.geoip.subdivision_1`                                                                | Client geo subdivision (e.g. `"CA"`) — see the legacy-field note below for how this differs from Vercel's own `region`        |
| `city`         | `ip.geoip.city`                                                                         |                                                                                                                               |
| `asn`          | `ip.geoip.asnum`                                                                        |                                                                                                                               |
| `path`         | `http.request.uri.path`                                                                 |                                                                                                                               |
| `host`         | `http.host`                                                                             |                                                                                                                               |
| `method`       | `http.request.method`                                                                   |                                                                                                                               |
| `header`       | `any(http.request.headers["key"][*] op value)` / `has_key(...)`                         | Requires `key` (the header name, lowercased before compiling) — see the keyed-field note below                                |
| `query`        | `http.request.uri.query`, or `any(http.request.uri.args["key"][*] op value)` when keyed | Unkeyed matches the whole query string; `key` scopes to one parameter — see the keyed-field note below                        |
| `cookie`       | `http.cookie`, or `any(http.request.cookies["key"][*] op value)` when keyed             | Unkeyed matches the whole `Cookie` header; keyed requires Cloudflare Pro/Business/Enterprise — see the keyed-field note below |
| `user_agent`   | `http.user_agent`                                                                       |                                                                                                                               |
| `referer`      | `http.referer`                                                                          |                                                                                                                               |
| `scheme`       | `ssl` (boolean)                                                                         |                                                                                                                               |
| `port`         | `cf.edge.server_port`                                                                   |                                                                                                                               |
| `threat_score` | `cf.threat_score`                                                                       | Cloudflare bot/attack threat score (0-100)                                                                                    |

**Keyed `header`/`cookie`/`query` conditions** ([doorman#269](https://github.com/gfargo/doorman/issues/269)): `http.request.headers`, `http.request.cookies`, and (when keyed) `http.request.uri.args` all type as Cloudflare's `Map<Array<String>>`, not a scalar `String` — indexing one yields an `Array<String>`, so a bare `field["key"] eq "value"` is an Array-vs-String type mismatch the Cloudflare API rejects. Doorman compiles a keyed condition to the idiom Cloudflare's Ruleset Engine actually documents instead: `any(field["key"][*] <op> value)` for a value comparison, `has_key(field, "key")` for `exists`/`not_exists`. A `header` condition always requires `key` — there's no "all headers as one value" fallback the way `cookie`'s unkeyed `http.cookie` is. `http.request.cookies` requires Cloudflare Pro, Business, or Enterprise; doorman emits it regardless of plan and lets Cloudflare's API reject it on an unsupported plan, the same policy already applied to `matches`/regex below.

### Operator Mapping

Cloudflare supports all 15 unified operators exactly, no approximation — `not_contains`/`not_in`/`not_exists` compile to a wrapped `not (...)` expression rather than a single wirefilter token, but the semantics are exact:

`eq`, `ne`, `contains`, `not_contains`, `starts_with`, `ends_with`, `matches`, `in`, `not_in`, `gt`, `ge`, `lt`, `le`, `exists`, `not_exists`

`matches` (regex) may be plan-restricted on Cloudflare's side — regex matching in the Ruleset Engine is an Enterprise-plan feature on some plans. Doorman always emits the correct `matches` expression regardless of plan; Cloudflare's API may reject it if your zone's plan doesn't support regex. Use `contains`/`starts_with`/`ends_with` as fallbacks if you hit this.

### Action Mapping

| Doorman Action | Cloudflare Action                | Notes                                                                                                                                               |
| -------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log`          | `log`                            |                                                                                                                                                     |
| `deny`         | `block`                          |                                                                                                                                                     |
| `challenge`    | `managed_challenge`              | Cloudflare's `challenge`/`managed_challenge`/`js_challenge` all fold back to unified `challenge` on `download` — a one-way narrowing, not a failure |
| `bypass`       | `skip`                           |                                                                                                                                                     |
| `allow`        | `allow`                          |                                                                                                                                                     |
| `block`        | `block`                          | Same target as `deny`                                                                                                                               |
| `rate_limit`   | `block` + `ratelimit` config     | ⚠️ If `action.rateLimit` is omitted, this silently becomes a plain unconditional `block` rule with no rate-limit effect — no error raised locally   |
| `redirect`     | `redirect` + `from_value` params | ⚠️ If `action.redirect` is omitted, this silently becomes a rule with no redirect target — no error raised locally                                  |

## Lists API (Bulk IP Management)

When `CLOUDFLARE_ACCOUNT_ID` is set, IP rules in the `ips` array are managed via Cloudflare's Lists API — a dedicated service for bulk IP blocking that scales better than individual rules.

```bash
# IPs in config are synced to a Cloudflare List
doorman sync --provider cloudflare
```

Without `CLOUDFLARE_ACCOUNT_ID`, IP blocking falls back to individual WAF rules with `ip.src` expressions — functional but limited by rule count quotas.

## Limitations & Differences

`protocol`, `target_path`, `environment`, `geo_continent`, `ja3_digest`, `ja4_digest`, `rate_limit_api_id` are **Vercel-native-only concepts** with no Cloudflare equivalent. Unlike what this doc previously claimed, they _are_ reachable through a `provider`/`providers`-tagged config — `UnifiedCondition.field` accepts arbitrary strings, and a Vercel rule using any of them translates straight through into the unified layer unchanged. Cloudflare's translator drops each one from the generated expression with a `TranslationWarning` rather than emitting invalid wirefilter ([doorman#271](https://github.com/gfargo/doorman/issues/271)); if _every_ condition on a rule falls into this set, translation throws rather than syncing a conditionless (match-everything) rule. Two related fields are handled specially, not dropped:

- Vercel's own `region` (the edge/deployment location a request was served from, e.g. `"sfo1"`) is namespaced internally to `vercel_region` so it can't collide with the unified `region` field in the table above (client geo subdivision) — before [doorman#270](https://github.com/gfargo/doorman/issues/270) the two silently shared one name, so a Vercel edge-region condition became a Cloudflare `ip.geoip.subdivision_1` check that could never match. `vercel_region` itself is still Cloudflare-unsupported and gets dropped-with-warning like the rest of this list.
- Vercel's `geo_country_region` ("Region/state code", e.g. `"CA"`) _is_ the same concept as the unified `region` field — it maps there directly and translates to `ip.geoip.subdivision_1` normally, unlike the rest of this list.

| Feature             | Cloudflare                               | Notes                                                                                                   |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `matches` (regex)   | Enterprise-plan-restricted on some plans | Doorman emits it regardless; Cloudflare's API may reject it — see Operator Mapping above                |
| IP Lists (bulk)     | Lists API                                | Needs `accountId`; without it, falls back to individual `ip.src` rules                                  |
| Max custom rules    | 5-125 (plan dependent)                   | Free: 5, Pro: 20, Business: 100, Enterprise: 125+                                                       |
| Rate limit          | Separate phase                           | `ratelimit` config attached to a `block` action, not a distinct rule type                               |
| Rule order          | Sequential (first match wins)            | `priority` is fully honoured — unlike Vercel, which can't reposition rules that already exist remotely  |
| Managed rule groups | Supported via `managedRules`             | See [Managed Rule Groups](#managed-rule-groups) below — Cloudflare-only among doorman's providers today |

## Translation Warnings

The `RuleTranslator` surfaces warnings when a translation is lossy:

- **Unmapped managed-ruleset override action** — an `action`/`overrides[].action` in `managedRules` with no Cloudflare equivalent (only `log`/`deny`/`challenge`/`allow` map cleanly) is dropped with a warning
- **Negation edge cases** — complex negated conditions may produce subtly different behavior in Wirefilter

Doorman does **not** currently warn on the `rate_limit`/`redirect` omitted-config-object cases noted in Action Mapping above — a known gap, not something `doorman validate` catches today. Double-check those specifically rather than relying on validation output.

Run `doorman validate` to surface the warnings that do exist before deploying — it auto-detects Cloudflare from the config's `provider` field.

## Cloudflare-Specific Validation

Doorman validates Cloudflare configs against:

- Expression syntax (Wirefilter grammar)
- Rule count limits per plan
- Action compatibility (e.g., `js_challenge` deprecated in favor of `managed_challenge`)
- List reference validity (when using Lists API)
- Rate limit configuration completeness

## Optimizer

The `CloudflareOptimizer` consolidates rules for efficient deployment:

- Merges rules with identical actions into single expressions using `or`
- Deduplicates IP entries across rules and Lists
- Computes minimal changesets to avoid unnecessary API calls (diff-based sync)

## Managed Rule Groups

Cloudflare is the only provider doorman can deploy vendor-managed rulesets (Cloudflare Managed Ruleset, OWASP CRS, etc.) for today. Add a `managedRules` array alongside `rules`/`ips`:

```json
{
  "managedRules": [
    {
      "id": "execute-owasp-crs",
      "ruleset": "efb7b8c949ac4650a09736fc376e9aee",
      "name": "OWASP Core Ruleset",
      "enabled": true,
      "action": "log",
      "overrides": [
        { "ruleId": "981176", "action": "deny" },
        { "ruleId": "981245", "enabled": false }
      ]
    }
  ]
}
```

| Property    | Type    | Required | Description                                                                                                                                                                        |
| ----------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string  | No       | Doorman's diff/sync identifier for this deployment. Omit for a new declaration — doorman assigns one on first sync.                                                                |
| `ruleset`   | string  | Yes      | The vendor ruleset id to deploy (e.g. Cloudflare Managed Ruleset's well-known id shown above)                                                                                      |
| `name`      | string  | No       | Human label                                                                                                                                                                        |
| `enabled`   | boolean | Yes      | Whether this deployment is active                                                                                                                                                  |
| `action`    | string  | No       | Ruleset-wide override — downgrade every rule in the group to this action. One of `log`, `deny`, `challenge`, `allow`                                                               |
| `overrides` | array   | No       | Per-rule overrides within the ruleset — `{ "ruleId": string, "action"?: string, "enabled"?: boolean }`, referenced by the _vendor's_ rule id within that ruleset, not a doorman id |

Managed rule groups deploy in Cloudflare's separate managed-rules phase, evaluated independently of custom `rules` — no ordering interaction to think about between the two. `getChanges`/`syncRules` diff `managedRules` the same way as `rules`/`ips` — `doorman diff`/`doorman sync` cover it with no extra flags.

## Example: Full Cloudflare Config

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "provider": "cloudflare",
  "providers": {
    "cloudflare": {
      "zoneId": "abc123def456",
      "accountId": "acc789xyz"
    }
  },
  "rules": [
    {
      "id": "rule_block_bots",
      "name": "Block Bad Bots",
      "description": "Block known malicious crawlers",
      "enabled": true,
      "conditions": [
        { "field": "user_agent", "operator": "contains", "value": "AhrefsBot", "group": 0 },
        { "field": "user_agent", "operator": "contains", "value": "SemrushBot", "group": 1 }
      ],
      "action": { "type": "deny" }
    },
    {
      "id": "rule_rate_limit_api",
      "name": "Rate Limit API",
      "description": "Limit API requests to 100/min per IP",
      "enabled": true,
      "conditions": [{ "field": "path", "operator": "starts_with", "value": "/api/" }],
      "action": {
        "type": "rate_limit",
        "rateLimit": {
          "requests": 100,
          "window": "1m",
          "characteristics": ["ip.src"]
        }
      }
    }
  ],
  "managedRules": [
    {
      "ruleset": "efb7b8c949ac4650a09736fc376e9aee",
      "name": "OWASP Core Ruleset",
      "enabled": true,
      "action": "log"
    }
  ],
  "ips": [{ "ip": "203.0.113.0/24", "action": "deny", "notes": "Known attack subnet" }]
}
```
