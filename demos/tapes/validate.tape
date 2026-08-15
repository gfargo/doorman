Source demos/tapes/_setup.tape

Output assets/demos/validate.gif

Hide
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "SEED=$(pwd)/demos/fixtures/sync-local.doorman.json" Enter
Type "mkdir -p demos/.fixtures/validate && cd demos/.fixtures/validate && cp $SEED .doorman.json && clear" Enter
Type "alias vercel-doorman=$REPO_BIN" Enter
Type "clear" Enter
Show

Type "vercel-doorman validate --verbose" Enter
Sleep 2800ms
