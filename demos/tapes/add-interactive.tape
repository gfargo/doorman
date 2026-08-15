Source demos/tapes/_setup.tape

Output assets/demos/add-interactive.gif

Hide
Type "REPO_BIN=$(pwd)/bin/run" Enter
Type "mkdir -p demos/.fixtures/add-interactive && cd demos/.fixtures/add-interactive && rm -f .doorman.json && clear" Enter
Type "alias vercel-doorman=$REPO_BIN" Enter
Type "vercel-doorman init empty --no-interactive > /dev/null" Enter
Type "clear" Enter
Show

Type "vercel-doorman add --interactive" Enter
Sleep 1200ms
Type "Block Admin Access"
Sleep 400ms
Enter
Sleep 700ms
Enter
Sleep 700ms
Enter
Sleep 700ms
Down
Sleep 500ms
Enter
Sleep 700ms
Type "/admin"
Sleep 300ms
Enter
Sleep 700ms
Enter
Sleep 700ms
Enter
Sleep 700ms
Enter
Sleep 700ms
Enter
Sleep 700ms
Enter
Sleep 700ms
Enter
Sleep 2200ms
