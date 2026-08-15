#!/usr/bin/env bash
# Renders VHS tapes in demos/tapes/*.tape into assets/demos/*.gif, then
# losslessly optimizes each GIF with gifsicle.
#
# Usage:
#   ./demos/capture.sh            # render every tape
#   ./demos/capture.sh add        # render only tapes matching "add"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FILTER="${1:-}"

if ! command -v vhs >/dev/null 2>&1; then
  echo "vhs is not installed. See https://github.com/charmbracelet/vhs#installation" >&2
  exit 1
fi

echo "==> Building CLI (dist/)"
pnpm build >/dev/null

mkdir -p assets/demos demos/.fixtures

for tape in demos/tapes/*.tape; do
  name="$(basename "$tape" .tape)"
  [[ "$name" == _* ]] && continue
  if [[ -n "$FILTER" && "$name" != *"$FILTER"* ]]; then
    continue
  fi
  echo "==> Rendering $name"
  vhs "$tape"
done

if command -v gifsicle >/dev/null 2>&1; then
  echo "==> Optimizing GIFs (gifsicle -O3)"
  for gif in assets/demos/*.gif; do
    [[ -e "$gif" ]] || continue
    before=$(wc -c < "$gif")
    gifsicle -O3 "$gif" -o "$gif.opt" && mv "$gif.opt" "$gif"
    after=$(wc -c < "$gif")
    echo "   $(basename "$gif"): $((before / 1024))KB -> $((after / 1024))KB"
  done
else
  echo "gifsicle not found — skipping lossless optimization (install with: brew install gifsicle)" >&2
fi

echo "==> Done"
