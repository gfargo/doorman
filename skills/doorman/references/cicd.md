# CI/CD & Automation Reference

Integrating Doorman into automated pipelines, export formats, and programmatic usage.

## CI/CD Pipeline Integration

Doorman commands return structured output and meaningful exit codes for automation.

### Validation in CI

```bash
# Fail the build if config is invalid
doorman validate --config .doorman.json
# Exit 0 = valid, Exit 1 = validation errors
```

### Diff Check (Detect Changes)

```bash
# Check if local config differs from deployed
doorman diff --format json --config .doorman.json
# Exit 0 = differences found (outputs JSON), Exit 1 = error
```

### Automated Sync

```bash
# Deploy rules non-interactively
doorman sync --config .doorman.json
```

### Full Pipeline Example (GitHub Actions)

```yaml
name: Deploy Firewall Rules
on:
  push:
    branches: [main]
    paths: ['.doorman.json']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm install -g @gfargo/doorman

      - name: Validate
        run: doorman validate --config .doorman.json

      - name: Preview Changes
        run: doorman diff --format json --config .doorman.json || true

      - name: Deploy
        run: doorman sync --config .doorman.json
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
          VERCEL_TEAM_ID: ${{ secrets.VERCEL_TEAM_ID }}
```

### Cloudflare Pipeline

```yaml
- name: Deploy to Cloudflare
  run: doorman sync --provider cloudflare --config .doorman.json
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

## Export Formats

```bash
doorman export --format json                    # JSON (default)
doorman export --format yaml                    # YAML
doorman export --format markdown                # Human-readable Markdown
doorman export --format terraform               # Terraform HCL
doorman export --output firewall-docs.md        # Write to file
```

### JSON Export

Full config dump, useful for backup or diffing:

```bash
doorman export --format json > firewall-backup.json
```

### YAML Export

Human-friendly format for documentation:

```bash
doorman export --format yaml --output firewall.yaml
```

### Markdown Export

Generate team-readable documentation:

```bash
doorman export --format markdown --output FIREWALL.md
```

Produces a table of all rules with their conditions, actions, and status.

### Terraform Export

Generate Terraform HCL for infrastructure-as-code repositories:

```bash
doorman export --format terraform --output firewall.tf
```

## Backup & Restore

```bash
# Create a timestamped backup
doorman backup

# List all backups
doorman backup --list

# Restore from a backup
doorman backup --restore <filename>
```

Backups are stored locally as JSON files. Include backup creation in your deployment pipeline as a safety net.

## Watch Mode (Development)

```bash
# Auto-validate and sync on file changes
doorman watch

# Watch a specific config
doorman watch --config .doorman.json
```

Watch mode is for development only — it syncs immediately on save. Do not use in production pipelines.

## Programmatic Usage (Node.js)

Doorman can be used as a library in Node.js applications:

```typescript
import { createDoorman } from '@gfargo/doorman/next'

// Next.js middleware integration
const doorman = createDoorman({
  // Configuration options
})
```

## Status & Health Monitoring

```bash
# Check sync status and configuration health
doorman status

# Machine-readable status
doorman status --format json
```

The health score evaluates:

- Rule descriptions present
- ID conventions followed (`rule_` prefix)
- Operator complexity (penalizes unnecessary regex)
- Active/inactive rule ratio
- Bot protection coverage
- Rate limiting coverage

## Multi-Environment Strategies

### Separate configs per environment

```bash
# Production
doorman sync --config .doorman.prod.json

# Staging (lighter rules)
doorman sync --config .doorman.staging.json
```

### Single config, different providers

```bash
# Same rules, different targets
doorman sync --provider vercel --config .doorman.json
doorman sync --provider cloudflare --config .doorman.json
```

### Download from one, deploy to another

```bash
# Migrate rules between providers
doorman download --provider vercel --config .doorman.json
doorman validate --provider cloudflare --config .doorman.json
doorman sync --provider cloudflare --config .doorman.json
```

## Command Flags Reference

Global flags available on all commands:

| Flag                                              | Description                                                    |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `--config <path>`                                 | Path to config file (default: auto-discovered `.doorman.json`) |
| `--provider vercel\|cloudflare\|fastly`           | Override provider detection                                    |
| `--format json\|table\|yaml\|markdown\|terraform` | Output format (command-dependent)                              |
| `--verbose`                                       | Show detailed output                                           |
| `--output <path>`                                 | Write output to file instead of stdout                         |

## Error Handling in Automation

Doorman exit codes:

- `0` — success
- `1` — error (validation failure, API error, config not found)

Errors are written to stderr in a structured format. In CI, capture stderr for diagnostics:

```bash
doorman sync 2> sync-errors.log || { cat sync-errors.log; exit 1; }
```

## Security Best Practices for CI/CD

1. **Never commit tokens** — use CI secrets/environment variables exclusively
2. **Validate before deploy** — always run `doorman validate` as a gate before `doorman sync`
3. **Use `doorman diff`** — review changes in PR checks before merge triggers deployment
4. **Backup before sync** — automate `doorman backup` before every `doorman sync` in production
5. **Pin the doorman version** — use `npm install -g @gfargo/doorman@3.x` to avoid unexpected breaking changes
6. **Limit token scope** — use the narrowest API token permissions possible (project-scoped for Vercel, zone-scoped for Cloudflare)
