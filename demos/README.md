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
│   ├── _setup.tape          # shared font/theme/padding, sourced by every tape
│   ├── quickstart.tape       -> assets/demos/quickstart.gif
│   ├── add-interactive.tape  -> assets/demos/add-interactive.gif
│   └── template-picker.tape  -> assets/demos/template-picker.gif
└── capture.sh
```

Each tape aliases `vercel-doorman` to the locally built `bin/run` and works in a scratch fixture under `demos/.fixtures/<name>/` (git-ignored) — no real Vercel/Cloudflare credentials involved. Only commands that work against a local `.doorman.json` (`init`, `add`, `template`, `validate`, …) are demoed this way; commands that require live API credentials (`status`, `diff`, `sync`, `list`, `download`) aren't captured here.
