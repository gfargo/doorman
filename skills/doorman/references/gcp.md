# GCP Cloud Armor Provider Reference

Google Cloud Armor support in Doorman (beta). Manage a Cloud Armor security policy's custom rules through the same config-as-code workflow as Vercel/Cloudflare/Fastly.

## Setup

### Environment Variables

Unlike the other three providers, GCP intentionally reuses GCP's own ecosystem-standard env var names rather than doorman-prefixed ones — a user with GCP already configured for anything else likely has these set already:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json  # Optional — service account key path; omit to use Application Default Credentials
GOOGLE_CLOUD_PROJECT=your-project-id              # Required — GCP project ID
GCP_POLICY_NAME=your-policy-name                  # Required — Cloud Armor security policy name (no ecosystem-standard env var exists for this)
```

### One-Time Project Setup

1. **Enable the Compute Engine API** — Cloud Armor security policies live under it:
   ```bash
   gcloud services enable compute.googleapis.com --project=YOUR_PROJECT
   ```
2. **Authenticate** — two options:
   - **Application Default Credentials** (recommended for local/dev use): `gcloud auth application-default login`. Uses your own Google account, no key file to create, store, or later revoke. Leave `serviceAccountKeyPath`/`GOOGLE_APPLICATION_CREDENTIALS` unset — `GoogleAuth` falls through to ADC automatically.
   - **Service account key** (for CI/production): create a service account with `roles/compute.securityAdmin` (the narrowest predefined role covering `securityPolicies.get/insert/patch/addRule/patchRule/removeRule/list`), generate a JSON key, and point `GOOGLE_APPLICATION_CREDENTIALS`/`serviceAccountKeyPath` at it.
3. **Create the security policy itself** — Doorman manages rules *within* an existing policy, it does not create the policy resource:
   ```bash
   gcloud compute security-policies create YOUR_POLICY_NAME --description="managed by doorman"
   ```

### Config Shape

Multi-provider config with explicit provider declaration:

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "provider": "gcp",
  "providers": {
    "gcp": {
      "projectId": "your-project-id",
      "policyName": "your-policy-name"
    }
  },
  "rules": [],
  "ips": []
}
```

Or pass `--provider gcp` to any provider-aware command to override auto-detection. `serviceAccountKeyPath` has no `configKey` — a filesystem path is environment-specific and never belongs in a config file meant to be shared/committed; set it via `GOOGLE_APPLICATION_CREDENTIALS` instead.

## Usage

`doorman init` only supports Vercel today — it has no `--provider` flag and doesn't prompt for GCP credentials. Create `.doorman.json` by hand using the config shape above, then:

```bash
doorman validate                    # Validate — auto-detects gcp from the config's `provider` field
doorman status --provider gcp
doorman diff --provider gcp
doorman sync --provider gcp
doorman download --provider gcp
```

## Rule Translation

Cloud Armor rules match on CEL (Common Expression Language) — an expression-string DSL, structurally the same problem as Cloudflare's Wirefilter. Doorman generates/parses only the flat subset Cloud Armor's real-world usage actually needs: Google's own docs cap this at "up to five subexpressions" combined with `&&`/`||`, no nesting — unlike Wirefilter, Cloud Armor's CEL condition tree never needs an OR nested inside an AND.

### Field Mapping

| Doorman Field | Cloud Armor CEL                                     | Notes                                                                              |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ip`           | `origin.ip == '...'` or `inIpRange(origin.ip, '...')` | Bare address uses `==`; a CIDR value (contains `/`) uses `inIpRange()`              |
| `path`         | `request.path`                                        |                                                                                     |
| `method`       | `request.method`                                      |                                                                                     |
| `country`      | `origin.region_code`                                  | Country-level only                                                                 |
| `asn`          | `origin.asn`                                          | Numeric comparison                                                                 |
| `host`         | `request.headers['host']`                             | Guarded with `has(...)` — indexing an absent header key is a CEL runtime error     |
| `user_agent`   | `request.headers['user-agent']`                       | Guarded with `has(...)`                                                            |
| `referer`      | `request.headers['referer']`                          | Guarded with `has(...)`                                                            |
| `header`       | `request.headers['<key>']`                            | Requires `key` (the header name); guarded with `has(...)`                          |
| `query`        | `request.query`                                       | Raw, undecoded query string — no parsed per-parameter map                          |
| `cookie`       | `request.headers['cookie']`                           | No parsed cookie map — see Cookie Matching below                                   |

Fields with **no CEL equivalent at all** (`region`, `city`, `port`, `scheme`) fail loudly with a clear error rather than being silently dropped or approximated — Cloud Armor has no continent/region/city-level geo attribute (only country-level `origin.region_code`), and no per-request port attribute (Cloud Armor operates at L7 behind a load balancer). A rule using one of these doesn't sync at all; there's no partial/lossy version of it to fall back to.

### Cookie Matching

Cloud Armor has no parsed per-cookie map, only the raw `Cookie` header string. Without a `key`, a cookie condition checks the whole header. *With* a `key` (the common case — "is this specific cookie set to this value") Doorman composes a `key=value` substring and searches for it in the raw header — the only thing CEL can actually check. Only `eq`/`ne`/`contains`/`not_contains` have an unambiguous meaning against that synthesized substring; any other operator on a keyed cookie condition throws rather than emitting a check that looks precise but isn't.

### Action Mapping

| Doorman Action | Cloud Armor Action | Notes                                                                 |
| --------------- | -------------------- | ----------------------------------------------------------------------- |
| `deny`, `block` | `deny(403)`           |                                                                        |
| `allow`         | `allow`               |                                                                        |
| `bypass`        | `allow`               |                                                                        |
| `rate_limit`    | `throttle`            | Requires `rateLimitOptions` — see below                               |
| `redirect`      | `redirect`             | Requires `redirectOptions` (target URL)                               |
| `log`           | `allow` + `preview: true` | No dedicated log-only action — evaluates and logs without enforcing |
| `challenge`     | `deny(403)` (with a warning) | No standalone challenge action for ordinary custom rules       |

## The Priority Model

Cloud Armor's real structural difference from every other provider: there is no separate, server-assigned rule id. A rule's `priority` — an explicit integer required on every rule — is simultaneously its doorman `id`, its evaluation order, **and** its addressing key for updates/deletes.

- A new local rule/IP with no priority yet gets one assigned automatically during `sync`, spaced 1000 apart (matching common Cloud Armor/`gcloud` convention), checked against a freshly-fetched remote policy to avoid collisions.
- **Cloud Armor has no "change priority" operation.** Editing a rule's `priority` in config relocates it via remove-then-add-at-the-new-priority — the only relocation path the real API supports — not an in-place PATCH.
- Cloud Armor rejects a priority that collides with an existing rule outright.

## No Dedicated IP-Blocking Resource

Unlike Vercel/Cloudflare/Fastly, Cloud Armor has no separate IP-list resource — an `ips[]` entry is just an ordinary rule under the hood, with a single `ip == X` (or `inIpRange(...)` for CIDR) CEL condition and nothing else layered on. Doorman classifies a fetched rule as an IP entry only when it has *exactly* that shape (one condition, `allow`/`deny(403)` action, nothing else) — a hand-authored `rules[]` entry that happens to match on `ip` alone is left as a rule, not silently reclassified into `ips[]`.

## The Mandatory Default Rule

Every real Cloud Armor security policy carries one rule Doorman never manages: a server-injected default catch-all at the maximum priority (`2147483647`), using a different match shape (`versionedExpr`/`config.srcIpRanges`, not CEL) — it cannot be removed, only its action changed. Doorman skips it entirely on fetch; it never appears in your local config and is never a candidate for deletion. If you need to change its action (rarely necessary — it only fires when nothing else matches), use `gcloud compute security-policies describe`/`update` directly.

Any *other* rule using that same basic (non-CEL) match shape — e.g. hand-created via `gcloud ... --src-ip-ranges` or the Console — gets an explicit warning on fetch rather than a crash or a silent drop: Doorman can't represent it, and leaves it unmanaged.

## Rate Limiting

`rate_limit` maps to Cloud Armor's `throttle` action, with `rateLimitOptions.rateLimitThreshold` (`count`/`intervalSec`) and `conformAction: 'allow'`/`exceedAction: 'deny(429)'`. A `rate_limit` rule with no `rateLimit` block configured emits a warning and will likely be rejected by the API — Cloud Armor requires `rateLimitOptions` for this action.

## Operations & Polling

Every mutating call (`addRule`/`patchRule`/`removeRule`) returns a long-running GCP Operation, not the updated resource directly. Doorman polls it internally — starting at 250ms, backing off toward a 1s ceiling, capped at 60s total — until it reports `DONE`, so every command still presents the same "await and it's done" shape the other three providers already have; GCP's async-operation model never leaks into the CLI surface.

## Limitations & Differences

| Feature                     | Vercel                        | GCP Cloud Armor                          | Notes                                                                    |
| ----------------------------- | -------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Rule ordering                | Best-effort (insertion order)     | Explicit required `priority`                | Lower priority number evaluates first; collisions rejected outright     |
| IP blocking                  | Dedicated resource                | Just a specially-shaped `rules[]` entry     | No separate list/resource — see above                                   |
| Geo targeting                | Country/city/continent/region     | Country only (`origin.region_code`)         | `region`/`city` fields throw rather than silently drop                  |
| Port / scheme conditions     | Yes                                | No CEL equivalent                            | Throw rather than silently drop                                         |
| Managed/vendor rule groups   | —                                  | Preconfigured WAF rules exist on the real API | Not yet configurable through Doorman for any provider (tracked separately) |
| Standalone challenge action  | Yes                                | No                                            | Falls back to `deny(403)` with a warning                                |
| Change a rule's priority     | N/A (no priority concept)         | Remove + re-add under the new priority       | No in-place relocation on the real API                                  |

## Manual End-to-End Verification

Cloud Armor is the one provider where a fully-offline mock-server e2e is not possible: `demos/cloudarmor-mock-server.mjs` can only exercise `CloudArmorClient`'s request/response handling once a caller already has a real, working `GoogleAuth` setup — `google-auth-library`'s OAuth2 token exchange has to reach Google's real `oauth2.googleapis.com` even for local testing (see that file's own top-of-file comment). Verifying a change to this provider for real means testing against an actual, disposable GCP resource:

1. Confirm `gcloud` is authenticated: `gcloud auth application-default login`.
2. Enable the API once per project: `gcloud services enable compute.googleapis.com --project=YOUR_PROJECT`.
3. Create a throwaway policy: `gcloud compute security-policies create doorman-e2e-test --description="disposable - safe to delete"`.
4. Hand-author a `.doorman.json` pointing `providers.gcp.projectId`/`policyName` at it, with a couple of rules and IPs. Use RFC 5737 documentation-only ranges for IPs (`203.0.113.0/24`, `198.51.100.0/24`, `192.0.2.0/24`) — never real addresses.
5. Run the full command surface against it: `status` → `diff` → `sync --ci` → `status` → `download --ci`. Then edit a rule's `priority` in the config and re-sync to exercise relocation, and remove a rule and run `sync --ci --allowDeletions` to exercise deletion — `sync --ci` alone correctly refuses to delete anything without that flag, rather than silently proceeding.
6. Delete the policy when done: `gcloud compute security-policies delete doorman-e2e-test --project=YOUR_PROJECT --quiet`.

**Cost**: Cloud Armor Standard is $5/policy/month + $1/rule/month (pay-as-you-go, prorated), independent of whether the policy is attached to a backend service. Trivial for a verification run lasting a few hours, but not literally free — delete the policy promptly when done.

## Example: Full GCP Config

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "provider": "gcp",
  "providers": {
    "gcp": {
      "projectId": "my-gcp-project",
      "policyName": "doorman-managed-policy"
    }
  },
  "rules": [
    {
      "name": "Block Bad Bots",
      "enabled": true,
      "conditions": [{ "field": "user_agent", "operator": "contains", "value": "AhrefsBot" }],
      "action": { "type": "deny" }
    },
    {
      "name": "Rate Limit API",
      "enabled": true,
      "conditions": [{ "field": "path", "operator": "starts_with", "value": "/api/" }],
      "action": {
        "type": "rate_limit",
        "rateLimit": { "requests": 100, "window": "1m" }
      }
    }
  ],
  "ips": [{ "ip": "203.0.113.0/24", "action": "deny", "notes": "Known attack subnet" }]
}
```
