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

Doorman translates its unified rule format into Cloudflare Wirefilter expressions automatically. The translation is bidirectional — `doorman download` pulls Cloudflare expressions back into the unified format.

### Field Mapping

| Doorman Type         | Cloudflare Field              |
| -------------------- | ----------------------------- |
| `path`               | `http.request.uri.path`       |
| `method`             | `http.request.method`         |
| `host`               | `http.host`                   |
| `user_agent`         | `http.user_agent`             |
| `ip_address`         | `ip.src`                      |
| `header`             | `http.request.headers["key"]` |
| `query`              | `http.request.uri.query`      |
| `cookie`             | `http.cookie`                 |
| `geo_country`        | `ip.geoip.country`            |
| `geo_city`           | `ip.geoip.city`               |
| `geo_continent`      | `ip.geoip.continent`          |
| `geo_country_region` | `ip.geoip.subdivision_1`      |
| `geo_as_number`      | `ip.geoip.asnum`              |
| `scheme`             | `ssl` (boolean)               |

### Action Mapping

| Doorman Action | Cloudflare Action                |
| -------------- | -------------------------------- |
| `deny`         | `block`                          |
| `challenge`    | `managed_challenge`              |
| `rate_limit`   | `block` + `ratelimit` config     |
| `redirect`     | `redirect` + `from_value` params |
| `log`          | `log`                            |
| `bypass`       | `skip`                           |

## Lists API (Bulk IP Management)

When `CLOUDFLARE_ACCOUNT_ID` is set, IP rules in the `ips` array are managed via Cloudflare's Lists API — a dedicated service for bulk IP blocking that scales better than individual rules.

```bash
# IPs in config are synced to a Cloudflare List
doorman sync --provider cloudflare
```

Without `CLOUDFLARE_ACCOUNT_ID`, IP blocking falls back to individual WAF rules with `ip.src` expressions — functional but limited by rule count quotas.

## Limitations & Differences

| Feature                   | Vercel              | Cloudflare                    | Notes                                             |
| ------------------------- | ------------------- | ----------------------------- | ------------------------------------------------- |
| `re` operator             | All plans           | Enterprise only               | Use `sub`/`pre`/`suf` as alternatives             |
| `environment` type        | Yes                 | No                            | Vercel-specific concept                           |
| `ja3_digest`/`ja4_digest` | Yes                 | No                            | Vercel TLS fingerprints                           |
| `region` type             | Yes                 | No                            | Vercel edge region                                |
| IP Lists (bulk)           | Individual rules    | Lists API                     | Cloudflare needs `accountId`                      |
| Max custom rules          | ~100                | 5-125 (plan dependent)        | Free: 5, Pro: 20, Business: 100, Enterprise: 125+ |
| Rate limit                | Via rule action     | Separate phase                | Different underlying mechanism                    |
| Rule order                | Parallel evaluation | Sequential (first match wins) | Ordering matters on Cloudflare                    |

## Translation Warnings

The `RuleTranslator` surfaces warnings when a translation is lossy:

- **Regex on non-Enterprise** — `re` operator only works on Cloudflare Enterprise; downgraded to `contains` with a warning
- **Unsupported types** — Vercel-only fields (`environment`, `ja3_digest`, `ja4_digest`, `region`) are dropped with a warning
- **Duration differences** — `actionDuration` maps differently between providers
- **Negation edge cases** — complex negated conditions may produce subtly different behavior in Wirefilter

Run `doorman validate` to surface warnings before deploying — it auto-detects Cloudflare from the config's `provider` field.

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
      "active": true,
      "conditionGroup": [
        { "conditions": [{ "type": "user_agent", "op": "sub", "value": "AhrefsBot" }] },
        { "conditions": [{ "type": "user_agent", "op": "sub", "value": "SemrushBot" }] }
      ],
      "action": { "mitigate": { "action": "deny" } }
    },
    {
      "id": "rule_rate_limit_api",
      "name": "Rate Limit API",
      "description": "Limit API requests to 100/min per IP",
      "active": true,
      "conditionGroup": [{ "conditions": [{ "type": "path", "op": "pre", "value": "/api/" }] }],
      "action": {
        "mitigate": {
          "action": "rate_limit",
          "rateLimit": {
            "requests": 100,
            "window": "1m",
            "characteristics": ["ip.src"]
          }
        }
      }
    }
  ],
  "ips": [{ "ip": "203.0.113.0/24", "action": "deny", "notes": "Known attack subnet" }]
}
```
