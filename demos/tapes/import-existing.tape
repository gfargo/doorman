Source demos/tapes/_setup.tape
Set Width 1900
Set Height 900

Output assets/demos/import-existing.gif

Hide
Type "pkill -f 'mock-server.mjs --port 4760' 2>/dev/null; true" Enter
Type "MOCK_SERVER=$(pwd)/demos/mock-server.mjs" Enter
Type "MOCK_FIXTURE=$(pwd)/demos/fixtures/import-existing.json" Enter
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "node $MOCK_SERVER --port 4760 --fixture $MOCK_FIXTURE > /dev/null 2>&1 & MOCKPID=$!" Enter
Type "sleep 1" Enter
Type "export DOORMAN_VERCEL_API_BASE_URL=http://127.0.0.1:4760/v1/security/firewall/config" Enter
Type "export VERCEL_TOKEN=demo_token_xxx VERCEL_PROJECT_ID=prj_demo123 VERCEL_TEAM_ID=team_demo456" Enter
Type "rm -rf demos/.fixtures/import-existing && mkdir -p demos/.fixtures/import-existing && cd demos/.fixtures/import-existing" Enter
Type "git init -q && git config user.email demo@doorman.dev && git config user.name 'Doorman Demo' && clear" Enter
Type "alias doorman=$REPO_BIN" Enter
Type "clear" Enter
Show

# A team member already configured these rules by hand in the Vercel
# dashboard — no doorman config exists locally yet.
Type "doorman download" Enter
Sleep 1800ms
Enter
Sleep 1500ms

Type "doorman validate --verbose" Enter
Sleep 1800ms

Type "git add .doorman.json && git commit -q -m 'Import existing Vercel Firewall rules'" Enter
Sleep 800ms

Type "git log --oneline -1" Enter
Sleep 1200ms

Hide
Type "kill $MOCKPID 2>/dev/null" Enter
Show
