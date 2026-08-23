# Demo captures

The GIFs in [`/assets/demos`](../assets/demos) are recorded from the real, built CLI using [VHS](https://github.com/charmbracelet/vhs) — no mockups or staged screenshots.

## Regenerating

```bash
brew install vhs gifsicle
./demos/capture.sh              # render every tape
./demos/capture.sh add          # render only tapes matching "add"
```

`capture.sh` builds the CLI, runs each `.tape` in [`tapes/`](tapes), and losslessly optimizes the resulting GIFs with `gifsicle -O3`.

## Layout

```
demos/
├── tapes/
│   ├── _setup.tape           # shared font/theme/padding, sourced by every tape
│   ├── quickstart.tape        -> assets/demos/quickstart.gif
│   ├── add-interactive.tape   -> assets/demos/add-interactive.gif
│   ├── template-picker.tape   -> assets/demos/template-picker.gif
│   ├── validate.tape          -> assets/demos/validate.gif
│   ├── list.tape              -> assets/demos/list.gif
│   ├── download.tape          -> assets/demos/download.gif
│   ├── sync.tape              -> assets/demos/sync.gif
│   ├── import-existing.tape   -> assets/demos/import-existing.gif
│   ├── fastly-sync.tape       -> assets/demos/fastly-sync.gif
│   └── cloudflare-sync.tape   -> assets/demos/cloudflare-sync.gif
├── fixtures/                 # JSON fixtures for the mock server + seeded local configs
├── mock-server.mjs           # minimal local stand-in for the Vercel Firewall Config API
├── fastly-mock-server.mjs    # minimal local stand-in for the Fastly Next-Gen WAF API
├── cloudflare-mock-server.mjs # minimal local stand-in for the Cloudflare Ruleset Engine API
└── capture.sh
```

Each tape aliases `doorman` to the locally built `bin/run` and works in a scratch fixture under `demos/.fixtures/<name>/` (git-ignored) — no real Vercel/Cloudflare/Fastly credentials involved.

`init`, `add`, `template`, and `validate` work directly against a local `.doorman.json`. `list`, `download`, `sync`, `import-existing`, `fastly-sync`, and `cloudflare-sync` normally need a live API token — those tapes instead start a mock server on a local port and point the CLI at it (`mock-server.mjs` + `DOORMAN_VERCEL_API_BASE_URL` for the Vercel tapes, see `src/lib/providers/vercel/VercelClient.ts`; `fastly-mock-server.mjs` + `DOORMAN_FASTLY_API_BASE_URL` for `fastly-sync`, see `src/lib/providers/fastly/FastlyClient.ts`; `cloudflare-mock-server.mjs` + `DOORMAN_CLOUDFLARE_API_BASE_URL` for `cloudflare-sync`, see `src/lib/providers/cloudflare/CloudflareClient.ts`), so they still run the real CLI/network code path, just against fixture data instead of production. `status` and `diff` aren't captured as their own Vercel tapes yet, but `fastly-sync` and `cloudflare-sync` exercise both as part of their story.

`import-existing` tells the "adopting doorman on a project that already has rules" story: `download` pulls hand-configured rules from the (mocked) Vercel dashboard into a fresh `.doorman.json`, `validate --verbose` confirms the result, and a `git commit` shows the config ready to check in.

`fastly-sync` and `cloudflare-sync` tell the same sync story as `sync`, but against Fastly Next-Gen WAF and Cloudflare WAF respectively, to show off doorman's provider-agnostic model: `status` and `diff` show pending changes against a seeded local config, `sync` deploys them (prompting for confirmation, same as every provider), and a closing `status` confirms convergence. `fastly-sync` covers a rule plus a managed IP list; `cloudflare-sync` covers a single rule (Cloudflare's ruleset-as-a-whole write model is exercised well enough by that alone).
