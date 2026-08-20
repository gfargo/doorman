Source demos/tapes/_setup.tape
Set Width 1900
Set Height 900

Output assets/demos/fastly-sync.gif

Hide
Type "pkill -f 'fastly-mock-server.mjs --port 4761' 2>/dev/null; true" Enter
Type "MOCK_SERVER=$(pwd)/demos/fastly-mock-server.mjs" Enter
Type "MOCK_FIXTURE=$(pwd)/demos/fixtures/fastly-sync-remote.json" Enter
Type "LOCAL_SEED=$(pwd)/demos/fixtures/fastly-sync-local.doorman.json" Enter
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "node $MOCK_SERVER --port 4761 --fixture $MOCK_FIXTURE > /dev/null 2>&1 & MOCKPID=$!" Enter
Type "sleep 1" Enter
Type "export DOORMAN_FASTLY_API_BASE_URL=http://127.0.0.1:4761" Enter
Type "export FASTLY_API_TOKEN=demo_token_xxx" Enter
Type "mkdir -p demos/.fixtures/fastly-sync && cd demos/.fixtures/fastly-sync && cp $LOCAL_SEED .doorman.json && clear" Enter
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
