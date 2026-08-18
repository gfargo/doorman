# Design Document

## Overview

The v2 unified configuration format replaces the Vercel-specific v1 format with a provider-agnostic schema. It uses Zod for runtime validation, supports automatic v1→v2 migration, and generates a JSON Schema for editor tooling. The format is designed to be extensible as new providers are added.

## Config Format Comparison

### v1 (Legacy Vercel-only)

```json
{
  "projectId": "prj_xxx",
  "teamId": "team_xxx",
  "rules": [
    {
      "id": "rule_1",
      "name": "Block bots",
      "active": true,
      "conditionGroup": [
        {
          "conditions": [{ "type": "user_agent", "op": "inc", "value": ["bot", "crawler"] }]
        }
      ],
      "action": { "mitigate": { "action": "deny" } }
    }
  ],
  "ips": [{ "id": "ip_1", "ip": "1.2.3.4", "action": "deny", "hostname": "example.com" }]
}
```

### v2 (Unified)

```json
{
  "$schema": "https://doorman.griffen.codes/schema.json",
  "version": "2.0",
  "provider": "vercel",
  "providers": {
    "vercel": { "projectId": "prj_xxx", "teamId": "team_xxx" },
    "cloudflare": { "zoneId": "zone_xxx", "accountId": "acct_xxx" }
  },
  "rules": [
    {
      "id": "rule_1",
      "name": "Block bots",
      "enabled": true,
      "conditions": [{ "field": "user_agent", "operator": "in", "value": ["bot", "crawler"] }],
      "conditionLogic": "OR",
      "action": { "type": "deny" }
    }
  ],
  "ips": [{ "id": "ip_1", "ip": "1.2.3.4", "action": "deny", "hostname": "example.com" }],
  "metadata": {
    "updatedAt": "2025-01-15T10:00:00Z"
  }
}
```

## Key Design Decisions

| Decision          | Choice                              | Rationale                                                                 |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Config filename   | `.doorman.json`                     | Dotfile convention, provider-neutral name                                 |
| Schema validation | Zod (runtime) + JSON Schema (IDE)   | Zod gives TypeScript types + validation; JSON Schema gives editor support |
| Operator names    | Verbose (`starts_with`, `contains`) | More readable than Vercel's abbreviations (`pre`, `sub`)                  |
| Field names       | Provider-agnostic (`ip`, `country`) | Decouples config from provider-specific terminology                       |
| Condition logic   | Explicit `conditionLogic` field     | v1 had implicit OR between groups, AND within — explicit is clearer       |
| IP rules          | Separate `ips` array                | Semantically different from expression-based rules; simpler schema        |
| Migration         | Auto in memory, no file rewrite     | Non-destructive; user's original file untouched                           |
| Version field     | String `"2.0"`                      | Allows semver-style versioning for future evolution                       |

## Schema Architecture

```
src/lib/types/common.ts          ← ActionType, Operator, FieldType, ConfigMetadata, ProvidersConfig
src/lib/types/unified.ts         ← UnifiedConfig, UnifiedRule, UnifiedCondition, UnifiedAction, UnifiedIPRule
src/lib/types/vercel.ts          ← Vercel-specific types (v1 format, API types)
src/lib/types/cloudflare.ts      ← Cloudflare-specific types

src/lib/schemas/commonSchemas.ts    ← Zod schemas for common types
src/lib/schemas/unifiedSchemas.ts   ← Zod schemas for unified config
src/lib/schemas/firewallSchemas.ts  ← Zod schemas for v1 Vercel config
src/lib/schemas/cloudflareSchemas.ts← Zod schemas for Cloudflare types
src/lib/schemas/schemaVersion.ts    ← Version detection + v1→v2 migration

schema/generate-schema.ts         ← Generates JSON Schema from Zod
schema/doorman.schema.json         ← Published JSON Schema output
```

### Type Hierarchy

```
UnifiedConfig
├── $schema?: string (URL to JSON Schema)
├── version?: string ("2.0")
├── provider?: ProviderType
├── providers?: ProvidersConfig
│   ├── vercel?: { projectId, teamId }
│   └── cloudflare?: { zoneId, accountId }
├── rules: UnifiedRule[]
│   ├── id?, name, description?, enabled
│   ├── conditions: UnifiedCondition[]
│   │   ├── field: FieldType | string
│   │   ├── operator: Operator
│   │   ├── value: string | number | string[] | number[]
│   │   ├── negated?: boolean
│   │   └── key?: string (for header/query/cookie)
│   ├── conditionLogic?: 'AND' | 'OR'
│   └── action: UnifiedAction
│       ├── type: ActionType
│       ├── rateLimit?: { requests, window, characteristics?, mitigationTimeout?, countingExpression? }
│       ├── redirect?: { location, statusCode?, permanent?, preserveQueryString? }
│       ├── response?: { statusCode?, content?, contentType? }
│       └── duration?: string
├── ips?: UnifiedIPRule[]
│   ├── id?, ip, hostname?, notes?, action: 'deny' | 'allow'
└── metadata?: ConfigMetadata
    ├── version?, updatedAt?, createdAt?, lastSyncedAt?
    ├── migratedFrom?, migratedAt?
```

## v1→v2 Migration Logic

### Field Mapping

| v1 (Vercel)                          | v2 (Unified)                     |
| ------------------------------------ | -------------------------------- |
| `projectId` (root)                   | `providers.vercel.projectId`     |
| `teamId` (root)                      | `providers.vercel.teamId`        |
| `rules[].active`                     | `rules[].enabled`                |
| `rules[].conditionGroup`             | `rules[].conditions` (flattened) |
| `conditionGroup[].conditions[].type` | `conditions[].field` (mapped)    |
| `conditionGroup[].conditions[].op`   | `conditions[].operator` (mapped) |
| `conditionGroup[].conditions[].neg`  | `conditions[].negated`           |
| `action.mitigate.action`             | `action.type`                    |
| `action.mitigate.rateLimit`          | `action.rateLimit`               |
| `action.mitigate.redirect`           | `action.redirect`                |

### Operator Mapping

| v1 Operator | v2 Operator   |
| ----------- | ------------- |
| `eq`        | `eq`          |
| `pre`       | `starts_with` |
| `suf`       | `ends_with`   |
| `inc`       | `in`          |
| `sub`       | `contains`    |
| `re`        | `matches`     |
| `ex`        | `exists`      |
| `nex`       | `not_exists`  |

### Field Type Mapping

| v1 Type                                                         | v2 Field     |
| --------------------------------------------------------------- | ------------ |
| `ip_address`                                                    | `ip`         |
| `geo_country`                                                   | `country`    |
| `geo_city`                                                      | `city`       |
| `geo_as_number`                                                 | `asn`        |
| `user_agent`                                                    | `user_agent` |
| `path`, `host`, `method`, `header`, `query`, `cookie`, `scheme` | same         |

## Config Discovery Order

1. Explicit `--config` CLI flag
2. `.doorman.json` in current or parent directory (via find-up)
3. `vercel-firewall.config.json` (legacy, with deprecation warning)
4. `vercel-firewall[project-name].config.json` (legacy project-specific)

## JSON Schema Generation

The `pnpm build:schema` command runs `schema/generate-schema.ts` which:

1. Imports Zod schemas from `src/lib/schemas/`
2. Converts to JSON Schema using `zod-to-json-schema`
3. Writes output to `schema/doorman.schema.json`
4. Published at `https://doorman.griffen.codes/schema.json`

This gives users `$schema` autocompletion in VS Code and other editors that support JSON Schema.

## Error Handling

- Zod validation errors are formatted with path and message for each failing field
- Version detection errors throw with specific unsupported version message
- Migration preserves all data — no fields are dropped, only restructured
- If provider section is missing for the declared provider, a clear error explains what to add

## Testing Strategy

- Schema tests validate all field types, operators, and edge cases
- Migration tests verify roundtrip accuracy from v1→v2
- Version detection tests cover all heuristic combinations
- Config discovery tests verify priority ordering and deprecation warnings
- JSON Schema output is snapshot-tested to catch accidental regressions
