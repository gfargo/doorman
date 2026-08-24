Source demos/tapes/_setup.tape
Set Width 1900
Set Height 700

Output assets/demos/gcp-sync.gif

# Unlike the other providers' tapes, this one can't be fully offline: GCP's
# GoogleAuth still mints a real OAuth2 access token against Google's real
# infrastructure (using the recorder's own `gcloud auth application-default
# login` session) even though the actual securityPolicies request/response
# traffic below is routed to the local mock server. Re-recording this tape
# requires live GCP credentials — see skills/doorman/references/gcp.md's
# "Manual End-to-End Verification" section.
Hide
Type "pkill -f 'cloudarmor-mock-server.mjs --port 4867' 2>/dev/null; true" Enter
Type "MOCK_SERVER=$(pwd)/demos/cloudarmor-mock-server.mjs" Enter
Type "MOCK_FIXTURE=$(pwd)/demos/fixtures/gcp-demo-remote.json" Enter
Type "LOCAL_SEED=$(pwd)/demos/fixtures/gcp-demo-local.doorman.json" Enter
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "node $MOCK_SERVER --port 4867 --fixture $MOCK_FIXTURE > /dev/null 2>&1 & MOCKPID=$!" Enter
Type "sleep 1" Enter
Type "export DOORMAN_GCP_API_BASE_URL=http://127.0.0.1:4867" Enter
Type "mkdir -p demos/.fixtures/gcp-sync && cd demos/.fixtures/gcp-sync && cp $LOCAL_SEED .doorman.json && clear" Enter
Type "alias doorman=$REPO_BIN" Enter
Type "clear" Enter
Show

Type "doorman sync" Enter
Sleep 3000ms
Enter
Sleep 3000ms

Hide
Type "kill $MOCKPID 2>/dev/null" Enter
Show
