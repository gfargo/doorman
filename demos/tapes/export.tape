Source demos/tapes/_setup.tape
Set Width 1200
Set Height 600

Output assets/demos/export.gif

Hide
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "LOCAL_SEED=$(pwd)/demos/fixtures/sync-local.doorman.json" Enter
Type "mkdir -p demos/.fixtures/export && cd demos/.fixtures/export && cp $LOCAL_SEED .doorman.json && clear" Enter
Type "alias doorman=$REPO_BIN" Enter
Type "clear" Enter
Show

Type "doorman export --format markdown --output firewall-report.md" Enter
Sleep 1800ms

Type "cat firewall-report.md" Enter
Sleep 4000ms
