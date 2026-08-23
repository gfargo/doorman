Source demos/tapes/_setup.tape
Set Width 1200
Set Height 600

Output assets/demos/backup.gif

Hide
Type "pkill -f 'mock-server.mjs --port 4763' 2>/dev/null; true" Enter
Type "MOCK_SERVER=$(pwd)/demos/mock-server.mjs" Enter
Type "MOCK_FIXTURE=$(pwd)/demos/fixtures/sync-remote.json" Enter
Type "LOCAL_SEED=$(pwd)/demos/fixtures/sync-local.doorman.json" Enter
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "node $MOCK_SERVER --port 4763 --fixture $MOCK_FIXTURE > /dev/null 2>&1 & MOCKPID=$!" Enter
Type "sleep 1" Enter
Type "export DOORMAN_VERCEL_API_BASE_URL=http://127.0.0.1:4763/v1/security/firewall/config" Enter
Type "export VERCEL_TOKEN=demo_token_xxx VERCEL_PROJECT_ID=prj_demo123 VERCEL_TEAM_ID=team_demo456" Enter
Type "rm -rf demos/.fixtures/backup && mkdir -p demos/.fixtures/backup && cd demos/.fixtures/backup && cp $LOCAL_SEED .doorman.json && clear" Enter
Type "alias doorman=$REPO_BIN" Enter
Type "clear" Enter
Show

Type "doorman backup" Enter
Sleep 2500ms

Type "doorman backup --list" Enter
Sleep 2200ms

Type `doorman backup --restore "$(ls backups | head -1)"` Enter
Sleep 1200ms
Enter
Sleep 2000ms

Hide
Type "kill $MOCKPID 2>/dev/null" Enter
Show
