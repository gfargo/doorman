# Auto-Sync to gfargo/skills

These files are templates for setting up auto-sync to the [gfargo/skills](https://github.com/gfargo/skills) central skills repository.

## Setup Steps

1. **In `gfargo/skills`**, create the plugin directory structure:

   ```
   plugins/security/
   plugins/security/.claude-plugin/plugin.json   <- copy plugin.json here
   plugins/security/skills/doorman/              <- synced from this repo
   ```

2. **Copy `sync-doorman.yml`** to `gfargo/skills/.github/workflows/sync-doorman.yml`

3. **Update `gfargo/skills/.claude-plugin/marketplace.json`** to add the security plugin:

   ```json
   {
     "name": "security",
     "source": "./plugins/security",
     "description": "Web application firewall management as code with Doorman: create rules, block IPs, rate limit, protect against bots, and deploy WAF configs to Vercel and Cloudflare.",
     "version": "1.0.0",
     "author": { "name": "Griffen Fargo" }
   }
   ```

4. The workflow runs daily and on `workflow_dispatch`. It:
   - Checks the latest release tag on `gfargo/doorman`
   - Compares against `.source-version` in the destination
   - If newer, clones at that tag, mirrors `skills/doorman/` content
   - Bumps the security plugin version, commits, tags, and creates a release

## Installation (end users)

Once published:

```bash
npx skills add gfargo/skills --skill doorman
```

Or via the `gfargo/skills` README install instructions.
