# Fastly Next-Gen WAF Provider Reference

Fastly Next-Gen WAF support in Doorman (beta). Manage Next-Gen WAF (formerly Signal Sciences) workspace rules through the same config-as-code workflow. Classic Fastly VCL services are **not** supported — only the Next-Gen WAF's structured rules API.

## Setup

### Environment Variables

```bash
FASTLY_API_TOKEN=your_token        # Required — Fastly API token
FASTLY_WORKSPACE_ID=workspace_xxx  # Required — Next-Gen WAF workspace to manage rules for
```

### API Token Permissions

Create a token at https://manage.fastly.com/account/personal/tokens with access to the Next-Gen WAF product for the target workspace.

### Config Shape

Multi-provider config with explicit provider declaration:

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "provider": "fastly",
  "providers": {
    "fastly": {
      "workspaceId": "your_workspace_id"
    }
  },
  "rules": [],
  "ips": []
}
```

Or pass `--provider fastly` to any command to override the default.

## Usage

```bash
doorman init --provider fastly          # Initialize Fastly config
doorman validate --provider fastly      # Validate against Fastly constraints
doorman sync --provider fastly          # Deploy to Fastly
doorman download --provider fastly      # Pull rules from Fastly
doorman diff --provider fastly          # Compare local vs live
doorman list --provider fastly          # Show deployed rules
```

## Rule Translation

Doorman translates its unified rule format into Fastly's structured `request`-type rules automatically. The translation is bidirectional — `doorman download` pulls Fastly rules back into the unified format.

### Field Mapping

| Doorman Field | Fastly Condition           | Notes                                                   |
| ------------- | -------------------------- | ------------------------------------------------------- |
| `path`        | `path`                     |                                                         |
| `method`      | `method`                   |                                                         |
| `host`        | `domain`                   |                                                         |
| `user_agent`  | `user_agent`               |                                                         |
| `ip`          | `ip`                       |                                                         |
| `country`     | `country`                  | Country-level only — no region/city/continent condition |
| `scheme`      | `scheme`                   |                                                         |
| `header`      | `request_header` multival  | Requires `key` (the header name)                        |
| `query`       | `query_parameter` multival | Requires `key` (the parameter name)                     |
| `cookie`      | `request_cookie` multival  | Requires `key` (the cookie name)                        |

Fields with no Fastly equivalent (`region`, `city`, `asn`, `referer`, `port`, `target_path`, `environment`, `ja3_digest`, `ja4_digest`) are dropped with a translation warning rather than silently mistranslated — the rule still syncs with its remaining conditions.

### Operator Mapping

| Doorman Operator           | Fastly Operator                             | Notes                                                          |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `eq`                       | `equals` (or `does_not_equal` if `negated`) |                                                                |
| `contains`                 | `contains` (or `does_not_contain`)          |                                                                |
| `matches`                  | `matches` (or `does_not_match`)             | Regex syntax may need adjustment                               |
| `starts_with`, `ends_with` | `like` (or `not_like`)                      | Fastly's wildcard matching isn't a true prefix/suffix operator |
| `in`                       | `in_list` (or `not_in_list`)                |                                                                |
| `gt`, `lt`                 | `greater_equal`, `lesser_equal`             | No strict `>`/`<` on Fastly — boundary value also matches      |

### Action Mapping

| Doorman Action  | Fastly Action                                   | Notes                                                                                          |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `block`, `deny` | `block`                                         |                                                                                                |
| `allow`         | `allow`                                         |                                                                                                |
| `challenge`     | `browser_challenge`                             |                                                                                                |
| `redirect`      | `redirect`                                      | Uses `redirect_url` + `response_code`                                                          |
| `rate_limit`    | Rule `type: rate_limit` + `block_signal` action | See Rate Limiting below                                                                        |
| `log`           | `allow` (with a warning)                        | Fastly has no dedicated log-only action; `request_logging` is set at the rule level regardless |
| `bypass`        | `allow` (with a warning)                        | No equivalent action                                                                           |

## Condition Grouping

Fastly's condition model is bounded to two levels — a rule's top-level conditions can be plain, or grouped, but a group's own members can never contain another group. This matches Doorman's flat `group` model exactly:

- Conditions sharing a `group` index are AND'd together.
- Distinct `group` values are OR'd against each other.
- A single implicit group (the common case) becomes flat top-level conditions.

## Rate Limiting

Fastly rate-limit rules are a distinct rule type (`type: "rate_limit"`) with their own `rate_limit` block (`threshold`, `interval`, `duration`, a counting `signal`). Doorman's `window` (e.g. `"60s"`, `"5m"`) is rounded to the nearest interval Fastly supports (60s / 600s / 3600s).

**Fastly rate-limit rules count requests against a named custom signal that must already exist in the workspace** — Doorman does not create it automatically. Create a signal named `doorman-rate-limit-<rule-id>` before syncing a rate-limit rule, or the sync will be rejected. A translation warning is emitted every time to make this easy to miss less easily.

## IP Blocking

Fastly has no per-IP-rule resource — Doorman manages two workspace **lists** of type `ip` (`doorman-managed-deny`, `doorman-managed-allow`), each replaced wholesale on sync (the same atomic-replace shape as Cloudflare's ruleset write, not Vercel's per-item writes). `hostname`/`notes` on an IP rule have no Fastly equivalent and are dropped with a warning — only the address is kept.

## No Draft/Publish Step

Unlike classic Fastly VCL services, Next-Gen WAF rule and list writes take effect immediately — there is no draft-then-activate version to manage. A rule's `enabled` flag is the only gate on whether it's live.

## Limitations & Differences

| Feature                    | Vercel                        | Fastly                 | Notes                                                                     |
| -------------------------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| Geo targeting              | Country/city/continent/region | Country only           | No sub-country condition field                                            |
| Rule ordering              | Best-effort (insertion order) | None                   | Next-Gen WAF rules are evaluated independently — `priority` has no effect |
| Managed/vendor rule groups | CRS (enterprise)              | Templated signal rules | Not yet configurable through Doorman for either provider (#183)           |
| Signal/exclusion rules     | —                             | `type: signal`         | Not managed by Doorman — see below                                        |

Fastly rules of type `signal` or `templated_signal` (which tag or exclude WAF signals rather than allow/block/redirect a request) are skipped entirely by `doorman download`/`fetchConfig` rather than forced into a lossy `UnifiedRule` — they simply don't appear in the local config.

## Example: Full Fastly Config

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "provider": "fastly",
  "providers": {
    "fastly": {
      "workspaceId": "abc123def456"
    }
  },
  "rules": [
    {
      "id": "rule_block_bots",
      "name": "Block Bad Bots",
      "enabled": true,
      "conditions": [
        { "field": "user_agent", "operator": "contains", "value": "AhrefsBot", "group": 0 },
        { "field": "user_agent", "operator": "contains", "value": "SemrushBot", "group": 1 }
      ],
      "action": { "type": "block" }
    },
    {
      "id": "rule_admin_header",
      "name": "Require internal header on admin paths",
      "enabled": true,
      "conditions": [
        { "field": "path", "operator": "starts_with", "value": "/admin", "group": 0 },
        {
          "field": "header",
          "operator": "eq",
          "value": "internal",
          "key": "X-Access-Level",
          "negated": true,
          "group": 0
        }
      ],
      "action": { "type": "block" }
    }
  ],
  "ips": [{ "ip": "203.0.113.0/24", "action": "deny" }]
}
```
