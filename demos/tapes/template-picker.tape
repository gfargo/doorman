Source demos/tapes/_setup.tape

Output assets/demos/template-picker.gif

Hide
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "mkdir -p demos/.fixtures/template-picker && cd demos/.fixtures/template-picker && rm -f .doorman.json && clear" Enter
Type "alias doorman=$REPO_BIN" Enter
Type "doorman init empty --no-interactive > /dev/null" Enter
Type "clear" Enter
Show

Type "doorman template" Enter
Sleep 1500ms
Enter
Sleep 2200ms
