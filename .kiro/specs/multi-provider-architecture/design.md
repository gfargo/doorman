# Design Document

## Overview

The multi-provider architecture transforms Doorman from a Vercel-only tool into a platform-agnostic firewall-as-code CLI. The design uses a provider abstraction pattern: commands interact with an `IFirewallProvider` interface, a registry manages provider lifecycle, and a translator layer handles format conversion between providers.

This architecture was implemented across Phases 1-5 of Cloudflare support and is now the foundation for all Doorman operations.

## Architecture

### High-Level Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI Commands (list, sync, diff, status, validate, etc.)         │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   withCredentials()    │  ← shared middleware
                    │   - load config        │
                    │   - detect provider    │
                    │   - resolve creds      │
                    │   - build context      │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   IFirewallProvider    │  ← uniform interface
                    │   - fetchConfig()      │
                    │   - syncRules()        │
                    │   - validateConfig()   │
                    │   - getChanges()       │
                    │   - verifyCredentials()│
                    └───┬───────────────┬────┘
                        │               │
          ┌─────────────▼──┐     ┌──────▼─────────────┐
          │ VercelProvider │     │ CloudflareProvider  │
          │ (VercelFWSvc)  │     │ (CloudflareFWSvc)  │
          └───────┬────────┘     └────────┬───────────┘
                  │                        │
          ┌───────▼────────┐     ┌────────▼───────────┐
          │  VercelClient  │     │ CloudflareClient   │
          │  (extends Base)│     │ (extends Base)     │
          └────────────────┘     └────────────────────┘
                                          │
                               ┌──────────▼───────────┐
                               │   RuleTranslator     │
                               │   Unified ↔ CF/Vercel│
                               │   + ExpressionBuilder│
                               └──────────────────────┘
```

### Provider Detection Flow

```
Config `provider` field → explicit, high confidence
        ↓ (not set)
Config `providers.cloudflare.zoneId` / `providers.vercel.projectId` → high confidence
        ↓ (not present)
Legacy root `projectId` → Vercel, high confidence
        ↓ (not present)
DOORMAN_PROVIDER env var → explicit, high confidence
        ↓ (not set)
CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN → Cloudflare, medium confidence
        ↓ (not present)
VERCEL_PROJECT_ID + VERCEL_TOKEN → Vercel, medium confidence
        ↓ (not present)
Fallback: Vercel (legacy default)
```

### Registry Lifecycle

```
App Start → initProviders()
                │
                ├── registry.register('vercel', () => VercelProvider.fromEnv())
                └── registry.register('cloudflare', () => CloudflareProvider.fromEnv())

Command Run → withCredentials()
                │
                ├── getProviderInstance() → registry.get(detectedType)
                │                                │
                │                                ├── (cached?) → return instance
                │                                └── (new?) → factory() → cache → return
                │
                └── CommandContext { provider, config, ... }
```

## Key Design Decisions

| Decision             | Choice                               | Rationale                                                              |
| -------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| Pattern              | Interface + Registry + Factory       | Clean separation; commands don't know which provider they talk to      |
| Singleton registry   | Yes                                  | Prevents duplicate provider instances, simplifies testing              |
| Lazy instantiation   | Yes                                  | Fast startup; providers only initialized when needed                   |
| Detection confidence | 3 levels (high/medium/low)           | Lets the system warn on ambiguous detection without failing            |
| Backward compat      | Legacy `client`/`service` in context | Existing Vercel commands continue to work unchanged                    |
| Translation warnings | Non-fatal with severity              | Users see what was lost but operations don't fail                      |
| Base classes         | Abstract client + service            | DRY: retries, rate limits, diffing, validation shared across providers |

## Component Details

### IFirewallProvider Interface

The core contract every provider implements:

- `fetchConfig()` — pull current remote state into unified format
- `syncRules(config, options)` — push local config to remote (supports dry-run, force)
- `validateConfig(config)` — check config against provider constraints
- `getChanges(config)` — diff local vs remote, return change set
- `getSupportedFeatures()` — declare capabilities (rate limiting, geo, redirect, etc.)
- `getHealthScore(config)` — assess config quality with recommendations
- `verifyCredentials()` — test API connectivity

### BaseFirewallClient

Abstract HTTP client providing:

- `makeRequest<T>(path, options)` — fetch with retry, timeout, rate-limit handling
- Automatic exponential backoff on 429 responses
- Timeout via AbortController with cleanup
- Rate limit info tracking from response headers
- Provider-specific auth headers via abstract `getAuthHeaders()`

### BaseFirewallService

Abstract service providing:

- `validateConfig()` — generic rules validation (providers override for specifics)
- `getHealthScore()` — scoring framework with issue detection
- `diffRules()` / `diffIPs()` — array diffing by ID for change detection
- Common metadata handling

### RuleTranslator

Static methods for bidirectional translation:

- `vercelToUnified()` / `unifiedToVercel()` — condition groups ↔ unified conditions
- `cloudflareToUnified()` / `unifiedToCloudflare()` — wirefilter expressions ↔ unified
- `vercelToCloudflare()` / `cloudflareToVercel()` — direct shortcuts
- `vercelIPToUnified()` / `unifiedIPToCloudflare()` — IP rule translation
- All methods return `TranslationResult<T>` with warnings for lossy conversions

### withCredentials() Middleware

Single entry point for all commands:

1. Load config (required/optional/raw/lenient modes)
2. Detect provider (ProviderDetector with config + env signals)
3. Resolve credentials (env vars, config, interactive prompts)
4. Instantiate provider via registry
5. Build `CommandContext` with provider + legacy compat fields
6. Wrap handler in try/catch with `handleCommandError()`

## Unified Type System

```typescript
UnifiedConfig {
  provider?: ProviderType
  providers?: { vercel?: {...}, cloudflare?: {...} }
  rules: UnifiedRule[]
  ips?: UnifiedIPRule[]
  metadata?: ConfigMetadata
}

UnifiedRule {
  id, name, description, enabled
  conditions: UnifiedCondition[]  // field + operator + value
  conditionLogic: 'AND' | 'OR'
  action: UnifiedAction           // type + rateLimit? + redirect?
}

UnifiedIPRule {
  id, ip, hostname, notes, action: 'deny' | 'allow'
}
```

## Testing Strategy

- Provider implementations tested in isolation with mocked HTTP clients
- RuleTranslator tested with fixtures covering all condition types and edge cases
- ProviderDetector tested with every signal combination
- withCredentials tested with mocked providers and various config scenarios
- Registry tested for singleton behavior, lazy creation, and error paths

## Security Considerations

- Credentials never logged (token substring only in debug mode)
- Provider detection doesn't leak which services a user has configured
- Base client aborts cleanly on timeout — no dangling connections
- Rate limit handling prevents credential lockout from API abuse
