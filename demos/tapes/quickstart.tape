Source demos/tapes/_setup.tape

Output assets/demos/quickstart.gif

Hide
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "mkdir -p demos/.fixtures/quickstart && cd demos/.fixtures/quickstart && rm -f .doorman.json && clear" Enter
Type "alias vercel-doorman=$REPO_BIN" Enter
Type "clear" Enter
Show

Type "vercel-doorman init security-focused --no-interactive" Enter
Sleep 3000ms

Type "vercel-doorman validate --verbose" Enter
Sleep 2800ms
