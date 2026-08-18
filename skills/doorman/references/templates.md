# Templates Reference

Pre-built rule templates for common security patterns. Add them to your config with a single command.

## Usage

```bash
doorman template                    # Browse available templates interactively
doorman template <name>             # Add a specific template
doorman template <name> --config ./path/to/config.json  # Add to specific config
```

Templates append rules to your existing config. Run `doorman validate` after adding to confirm compatibility.

## Available Templates

### ai-bots

**Block AI Bots Firewall Rule**

Detects and logs known AI crawlers and training data scrapers. Default action is `log` — change to `deny` or `challenge` after reviewing traffic.

```bash
doorman template ai-bots
```

Detected bots include: GPTBot, ChatGPT-User, ClaudeBot, Claude-Web, Bytespider, CCBot, Google-Extended, GoogleOther, Amazonbot, Applebot-Extended, Meta-ExternalAgent, PerplexityBot, OAI-SearchBot, Diffbot, anthropic-ai, cohere-ai, and many more.

**Rule added:**
```json
{
  "id": "rule_detect_ai_bots",
  "name": "Detect AI Bots",
  "active": true,
  "conditionGroup": [
    { "conditions": [{ "type": "user_agent", "op": "re", "value": "GPTBot|ChatGPT-User|ClaudeBot|..." }] }
  ],
  "action": { "mitigate": { "action": "log" } }
}
```

**Customization**: Change `"action": "log"` to `"action": "deny"` to block, or `"action": "challenge"` to CAPTCHA.

**Note**: Uses `re` (regex) operator — works on all Vercel plans, but Cloudflare Enterprise only. For Cloudflare non-Enterprise, split into multiple `sub` (contains) conditions instead.

---

### bad-bots

**Block Bad Bots Firewall Rule**

Detects known malicious bots, scrapers, vulnerability scanners, and attack tools. Comprehensive list of 500+ known bad user agents.

```bash
doorman template bad-bots
```

Includes: scrapers (HTTrack, WebCopier, SiteRipper), vulnerability scanners (Nikto, Nmap, Acunetix, SQLmap, WPScan, Nuclei), SEO crawlers (AhrefsBot, SemrushBot, MJ12bot, DotBot), and spam/attack tools (Zeus, Havij, Dirbuster).

**Rule added:**
```json
{
  "id": "rule_detect_bad_bots",
  "name": "Detect Bad Bots",
  "active": true,
  "conditionGroup": [
    { "conditions": [{ "type": "user_agent", "op": "re", "value": "AhrefsBot|SemrushBot|MJ12bot|..." }] }
  ],
  "action": { "mitigate": { "action": "log" } }
}
```

**Customization**: Same as ai-bots — change action to `deny` for production blocking. Consider `challenge` for borderline bots.

---

### block-ofac-sanctioned-countries

**Block OFAC-Sanctioned Countries**

Blocks traffic from countries under US OFAC (Office of Foreign Assets Control) sanctions. Enforces a one-hour persistent block after first violation.

```bash
doorman template block-ofac-sanctioned-countries
```

Countries blocked: Syria (SY), Iran (IR), Russia (RU), Cuba (CU), North Korea (KP).

**Rule added:**
```json
{
  "id": "rule_block_traffic_from_ofac_sanctioned_countries",
  "name": "Block traffic from OFAC-sanctioned countries",
  "description": "Blocks traffic from OFAC-sanctioned countries and enforces a one-hour persistent block after the first violation.",
  "active": true,
  "conditionGroup": [
    { "conditions": [{ "type": "geo_country", "op": "inc", "value": ["SY", "IR", "RU", "CU", "KP"] }] }
  ],
  "action": { "mitigate": { "action": "deny", "actionDuration": "1h" } }
}
```

**Customization**: Add or remove country codes as sanctions change. Consult https://sanctionssearch.ofac.treas.gov/ for the current list.

---

### wordpress

**Deny Common WordPress URLs Firewall Rule**

Blocks requests to WordPress-specific paths that are common attack vectors on non-WordPress sites. If your site does not run WordPress, these paths should never receive legitimate traffic.

```bash
doorman template wordpress
```

Paths blocked: `/wp-admin`, `/wp-login.php`, `/xmlrpc.php`, `/wp-content`, `/wp-includes`, `/wp-signup.php`, `/wp-activate.php`, `/register.php`, `/wp-register.php`

**Rule added:**
```json
{
  "name": "Deny WordPress URLs",
  "active": true,
  "conditionGroup": [
    { "conditions": [{ "type": "path", "op": "re", "value": "/(wp-admin|wp-login\\.php|xmlrpc\\.php|wp-content|wp-includes|wp-signup\\.php|wp-activate\\.php|register\\.php|wp-register\\.php)" }] }
  ],
  "action": { "mitigate": { "action": "deny" } }
}
```

**Note**: Uses regex — for Cloudflare non-Enterprise, split into multiple `pre` (prefix) conditions:
```json
"conditionGroup": [
  { "conditions": [{ "type": "path", "op": "pre", "value": "/wp-admin" }] },
  { "conditions": [{ "type": "path", "op": "pre", "value": "/wp-login.php" }] },
  { "conditions": [{ "type": "path", "op": "pre", "value": "/xmlrpc.php" }] },
  { "conditions": [{ "type": "path", "op": "pre", "value": "/wp-content" }] }
]
```

## Creating Custom Templates

Templates are TypeScript modules in `src/lib/templates/rules/`. Each exports a `Template` object:

```typescript
import { Template } from '../types'

export const myTemplate: Template = {
  metadata: {
    title: 'My Custom Template',
    reference: 'https://example.com/docs',
  },
  config: {
    rules: [
      {
        id: 'rule_my_template',
        name: 'My Rule',
        description: 'What it does',
        active: true,
        conditionGroup: [
          { conditions: [{ type: 'path', op: 'pre', value: '/protected' }] }
        ],
        action: { mitigate: { action: 'deny' } },
      },
    ],
  },
}
```

Register it in `src/lib/templates/index.ts` to make it available via `doorman template <name>`.

## Template Best Practices

1. **Start with `log` action** — observe traffic before blocking. Switch to `deny` once confident.
2. **Add descriptions** — templates without descriptions lower the health score.
3. **Combine templates** — use multiple templates together for layered security.
4. **Validate after adding** — always run `doorman validate` after adding a template.
5. **Review regex patterns** — template regex patterns are comprehensive but may need tuning for your specific use case.

## Recommended Starter Stack

```bash
doorman template ai-bots
doorman template bad-bots
doorman template wordpress
doorman template block-ofac-sanctioned-countries
doorman validate
doorman sync
```

This gives you bot protection, attack path blocking, and geo-compliance in under a minute.
