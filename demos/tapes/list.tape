Source demos/tapes/_setup.tape
Set Width 1900
Set Height 800

Output assets/demos/list.gif

Hide
Type "pkill -f 'mock-server.mjs --port 4757' 2>/dev/null; true" Enter
Type "MOCK_SERVER=$(pwd)/demos/mock-server.mjs" Enter
Type "MOCK_FIXTURE=$(pwd)/demos/fixtures/list.json" Enter
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "node $MOCK_SERVER --port 4757 --fixture $MOCK_FIXTURE > /dev/null 2>&1 & MOCKPID=$!" Enter
Type "sleep 1" Enter
Type "export DOORMAN_VERCEL_API_BASE_URL=http://127.0.0.1:4757/v1/security/firewall/config" Enter
Type "export VERCEL_TOKEN=demo_token_xxx VERCEL_PROJECT_ID=prj_demo123 VERCEL_TEAM_ID=team_demo456" Enter
Type "mkdir -p demos/.fixtures/list && cd demos/.fixtures/list && rm -f .doorman.json && clear" Enter
Type "alias doorman=$REPO_BIN" Enter
Type "clear" Enter
Show

Type "doorman list" Enter
Sleep 3000ms

Hide
Type "kill $MOCKPID 2>/dev/null" Enter
Show
