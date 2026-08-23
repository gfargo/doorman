Source demos/tapes/_setup.tape
Set Width 1900
Set Height 900

Output assets/demos/cloudflare-sync.gif

Hide
Type "pkill -f 'cloudflare-mock-server.mjs --port 4762' 2>/dev/null; true" Enter
Type "MOCK_SERVER=$(pwd)/demos/cloudflare-mock-server.mjs" Enter
Type "MOCK_FIXTURE=$(pwd)/demos/fixtures/cloudflare-sync-remote.json" Enter
Type "LOCAL_SEED=$(pwd)/demos/fixtures/cloudflare-sync-local.doorman.json" Enter
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "node $MOCK_SERVER --port 4762 --fixture $MOCK_FIXTURE > /dev/null 2>&1 & MOCKPID=$!" Enter
Type "sleep 1" Enter
Type "export DOORMAN_CLOUDFLARE_API_BASE_URL=http://127.0.0.1:4762" Enter
Type "export CLOUDFLARE_API_TOKEN=demo_token_xxx CLOUDFLARE_ZONE_ID=zone_demo123" Enter
Type "mkdir -p demos/.fixtures/cloudflare-sync && cd demos/.fixtures/cloudflare-sync && cp $LOCAL_SEED .doorman.json && clear" Enter
Type "alias doorman=$REPO_BIN" Enter
Type "clear" Enter
Show

Type "doorman status" Enter
Sleep 2100ms

Type "doorman diff" Enter
Sleep 2100ms

Type "doorman sync" Enter
Sleep 2500ms
Enter
Sleep 2200ms

Type "doorman status" Enter
Sleep 2500ms

Hide
Type "kill $MOCKPID 2>/dev/null" Enter
Show
