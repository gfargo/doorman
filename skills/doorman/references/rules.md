# Rule Authoring Reference

Complete reference for creating and configuring Doorman firewall rules.

> **Format note:** this reference covers the **legacy (Vercel-only) rule format** — no `provider`/`providers` field in the config. If your config has `provider`/`providers` set (required for Cloudflare/Fastly), rules use a different shape entirely (`conditions`/`enabled`/flat `action: {type}` instead of `conditionGroup`/`active`/`action: {mitigate}`) — see [cloudflare.md](cloudflare.md)/[fastly.md](fastly.md) for the correct format and field/operator/action support per provider, and `SKILL.md`'s "Rule Shape" section for a side-by-side comparison.

## Rule Structure

Every rule in the `rules` array has this shape:

```json
{
  "id": "rule_descriptive_name",
  "name": "Human-Readable Name",
  "description": "What this rule does and why",
  "active": true,
  "conditionGroup": [
    {
      "conditions": [
        /* AND — all must match */
      ]
    },
    {
      "conditions": [
        /* OR — this group is an alternative */
      ]
    }
  ],
  "action": { "mitigate": { "action": "deny" } }
}
```

### Fields

| Field            | Type    | Required | Description                                                                           |
| ---------------- | ------- | -------- | ------------------------------------------------------------------------------------- |
| `id`             | string  | No       | Unique identifier. Convention: `rule_` prefix, snake_case. Auto-generated if omitted. |
| `name`           | string  | Yes      | Display name shown in tables and logs.                                                |
| `description`    | string  | No       | Explains the rule's purpose. Improves health score.                                   |
| `active`         | boolean | Yes      | `true` to enforce, `false` to disable without deleting.                               |
| `conditionGroup` | array   | Yes      | Array of condition groups (see below).                                                |
| `action`         | object  | Yes      | What to do when conditions match (see below).                                         |

## Condition Groups

```json
"conditionGroup": [
  { "conditions": [/* AND — all must match */] },
  { "conditions": [/* OR — this group is an alternative */] }
]
```

**Logic**:

- Conditions **within** a group: AND (all must match)
- **Between** groups: OR (any group matching triggers the rule)

## Conditions

Each condition has:

```json
{ "type": "field_type", "op": "operator", "value": "match_value", "key": "header_name", "neg": false }
```

| Field   | Type                | Required | Description                                                   |
| ------- | ------------------- | -------- | ------------------------------------------------------------- |
| `type`  | string              | Yes      | What to match against (see types below).                      |
| `op`    | string              | Yes      | How to compare (see operators below).                         |
| `value` | string/number/array | Yes      | Value to match. Arrays for `inc` operator.                    |
| `key`   | string              | No       | Required for `header`, `query`, `cookie` types.               |
| `neg`   | boolean             | No       | `true` to negate the condition (NOT logic). Default: `false`. |

### Condition Types

| Type                 | Description                      | Example Value           |
| -------------------- | -------------------------------- | ----------------------- |
| `path`               | URL path                         | `"/api/users"`          |
| `method`             | HTTP method                      | `"POST"`                |
| `host`               | Hostname                         | `"example.com"`         |
| `user_agent`         | User-Agent header                | `"Googlebot"`           |
| `ip_address`         | Client IP                        | `"192.168.1.1"`         |
| `header`             | HTTP header (requires `key`)     | `"application/json"`    |
| `query`              | Query parameter (requires `key`) | `"true"`                |
| `cookie`             | Cookie value (requires `key`)    | `"session_abc"`         |
| `geo_country`        | Country code (ISO 3166-1)        | `"US"` or `["US","CA"]` |
| `geo_city`           | City name                        | `"New York"`            |
| `geo_continent`      | Continent code                   | `"NA"`                  |
| `geo_country_region` | Region/state code                | `"CA"`                  |
| `geo_as_number`      | ASN number                       | `13335`                 |
| `scheme`             | URL scheme                       | `"https"`               |
| `protocol`           | HTTP protocol version            | `"HTTP/2"`              |

**Vercel-only types** (not available on Cloudflare):

- `environment` — deployment environment (`"production"`, `"preview"`)
- `ja3_digest` — TLS fingerprint
- `ja4_digest` — TLS fingerprint v4
- `region` — Vercel edge region
- `rate_limit_api_id` — rate limit API identifier

### Operators

| Operator | Name       | Description                 | Value Type             |
| -------- | ---------- | --------------------------- | ---------------------- |
| `eq`     | Equals     | Exact match                 | string/number          |
| `pre`    | Prefix     | Starts with                 | string                 |
| `suf`    | Suffix     | Ends with                   | string                 |
| `sub`    | Substring  | Contains                    | string                 |
| `inc`    | Includes   | Is any of (array match)     | string[]               |
| `re`     | Regex      | Regular expression match    | string (regex pattern) |
| `ex`     | Exists     | Field/header exists         | `true`                 |
| `nex`    | Not Exists | Field/header does not exist | `true`                 |

### Using `key` for Header/Query/Cookie

```json
{ "type": "header", "op": "eq", "value": "application/json", "key": "Content-Type" }
{ "type": "query", "op": "eq", "value": "true", "key": "debug" }
{ "type": "cookie", "op": "ex", "value": true, "key": "session_id" }
```

### Using `neg` for Negation

```json
{ "type": "geo_country", "op": "inc", "value": ["US", "CA", "GB"], "neg": true }
```

This matches requests NOT from US, CA, or GB.

## Actions

### Deny (Block)

```json
{ "action": { "mitigate": { "action": "deny" } } }
```

### Deny with Duration

```json
{ "action": { "mitigate": { "action": "deny", "actionDuration": "1h" } } }
```

Duration formats: `"30s"`, `"5m"`, `"1h"`, `"1d"`, `"permanent"`

### Challenge (CAPTCHA)

```json
{ "action": { "mitigate": { "action": "challenge" } } }
```

### Rate Limit

```json
{
  "action": {
    "mitigate": {
      "action": "rate_limit",
      "rateLimit": {
        "requests": 100,
        "window": "60s"
      }
    }
  }
}
```

| Field                | Type     | Required | Description                                                                                                                            |
| -------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `requests`           | number   | Yes      | Max requests allowed in window.                                                                                                        |
| `window`             | string   | Yes      | Time window: `"10s"`, `"1m"`, `"5m"`, `"1h"`                                                                                           |
| `characteristics`    | string[] | No       | What to rate limit by. Default: `["ip.src"]`. Options: `"ip.src"`, `"http.request.uri.path"`, `"http.request.headers[\"user-agent\"]"` |
| `mitigationTimeout`  | number   | No       | How long (seconds) to block after limit exceeded. Default: 3600.                                                                       |
| `countingExpression` | string   | No       | Cloudflare-specific: expression for what counts toward the limit.                                                                      |

### Redirect

```json
{
  "action": {
    "mitigate": {
      "action": "redirect",
      "redirect": { "location": "https://example.com/blocked", "permanent": false }
    }
  }
}
```

| Field       | Type    | Description                               |
| ----------- | ------- | ----------------------------------------- |
| `location`  | string  | Redirect URL (absolute or relative path). |
| `permanent` | boolean | `true` for 301, `false` for 302.          |

### Log Only

```json
{ "action": { "mitigate": { "action": "log" } } }
```

### Bypass

```json
{ "action": { "mitigate": { "action": "bypass" } } }
```

## IP Blocking Rules

IP rules go in the `ips` array, separate from `rules`:

```json
{
  "ips": [
    {
      "id": "ip_malicious_actor",
      "ip": "192.168.1.100/32",
      "hostname": "attacker.example.com",
      "action": "deny",
      "notes": "Blocked 2024-01-15: repeated brute force attempts"
    }
  ]
}
```

| Field      | Type   | Required | Description                                         |
| ---------- | ------ | -------- | --------------------------------------------------- |
| `id`       | string | No       | Unique identifier.                                  |
| `ip`       | string | Yes      | IP address or CIDR range. Use `/32` for single IPs. |
| `hostname` | string | No       | Associated hostname (documentation only).           |
| `action`   | string | Yes      | `"deny"` (only supported value currently).          |
| `notes`    | string | No       | Why this IP was blocked.                            |

### CIDR Notation

```
192.168.1.1/32    -> single IP
192.168.1.0/24    -> 256 IPs (192.168.1.0 - 192.168.1.255)
10.0.0.0/8        -> class A range
0.0.0.0/0         -> all IPv4 (use with caution!)
```

## Common Patterns

### Block multiple countries

```json
{
  "name": "OFAC Sanctions Compliance",
  "active": true,
  "conditionGroup": [
    { "conditions": [{ "type": "geo_country", "op": "inc", "value": ["CU", "IR", "KP", "SY", "RU"] }] }
  ],
  "action": { "mitigate": { "action": "deny" } }
}
```

### Allow only specific countries (block everyone else)

```json
{
  "name": "Allow Only US/CA/GB",
  "active": true,
  "conditionGroup": [
    { "conditions": [{ "type": "geo_country", "op": "inc", "value": ["US", "CA", "GB"], "neg": true }] }
  ],
  "action": { "mitigate": { "action": "deny" } }
}
```

### Rate limit API with path + method

```json
{
  "name": "Rate Limit POST to API",
  "active": true,
  "conditionGroup": [
    {
      "conditions": [
        { "type": "path", "op": "pre", "value": "/api/" },
        { "type": "method", "op": "eq", "value": "POST" }
      ]
    }
  ],
  "action": {
    "mitigate": {
      "action": "rate_limit",
      "rateLimit": { "requests": 50, "window": "1m" },
      "actionDuration": "5m"
    }
  }
}
```

### Block by header (missing auth)

```json
{
  "name": "Block Missing API Key",
  "active": true,
  "conditionGroup": [
    {
      "conditions": [
        { "type": "path", "op": "pre", "value": "/api/" },
        { "type": "header", "op": "nex", "value": true, "key": "X-API-Key" }
      ]
    }
  ],
  "action": { "mitigate": { "action": "deny" } }
}
```

### Challenge suspicious user agents

```json
{
  "name": "Challenge Suspicious Bots",
  "active": true,
  "conditionGroup": [
    { "conditions": [{ "type": "user_agent", "op": "sub", "value": "curl" }] },
    { "conditions": [{ "type": "user_agent", "op": "sub", "value": "wget" }] },
    { "conditions": [{ "type": "user_agent", "op": "sub", "value": "python-requests" }] }
  ],
  "action": { "mitigate": { "action": "challenge" } }
}
```

### Block WordPress attack paths (regex)

```json
{
  "name": "Block WordPress Paths",
  "active": true,
  "conditionGroup": [
    { "conditions": [{ "type": "path", "op": "re", "value": "/(wp-admin|wp-login\\.php|xmlrpc\\.php|wp-content)" }] }
  ],
  "action": { "mitigate": { "action": "deny" } }
}
```

### Redirect old paths

```json
{
  "name": "Redirect Legacy API",
  "active": true,
  "conditionGroup": [{ "conditions": [{ "type": "path", "op": "pre", "value": "/v1/api/" }] }],
  "action": {
    "mitigate": {
      "action": "redirect",
      "redirect": { "location": "/v2/api/", "permanent": true }
    }
  }
}
```

## Health Score Tips

To maximize your configuration health score:

- Add `description` to every rule
- Use `id` fields with `rule_` prefix and snake_case
- Avoid regex when simpler operators work
- Remove disabled rules you no longer need
- Include rate limiting for API endpoints
- Include bot protection rules
- Use IP blocking for known threats
