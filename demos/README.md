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
│   └── sync.tape              -> assets/demos/sync.gif
├── fixtures/                 # JSON fixtures for the mock server + seeded local configs
├── mock-server.mjs           # minimal local stand-in for the Vercel Firewall Config API
└── capture.sh
```

Each tape aliases `doorman` to the locally built `bin/run` and works in a scratch fixture under `demos/.fixtures/<name>/` (git-ignored) — no real Vercel/Cloudflare credentials involved.

`init`, `add`, `template`, and `validate` work directly against a local `.doorman.json`. `list`, `download`, and `sync` normally need a live Vercel API token — those tapes instead start `mock-server.mjs` on a local port and point the CLI at it via `DOORMAN_VERCEL_API_BASE_URL` (see `src/lib/services/VercelClient.ts`), so they still run the real CLI/network code path, just against fixture data instead of production. `status` and `diff` aren't captured yet but could follow the same pattern.
