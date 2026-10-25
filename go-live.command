#!/bin/zsh
# Double-click to get the live site ready: database changes, notification keys, moderators,
# email codes, Google and Apple sign-in. Asks before each step and is safe to run again.
# See scripts/go-live.mjs for exactly what it does.
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if [ ! -d node_modules/wrangler ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm install || exit 1
fi

node scripts/go-live.mjs
echo ""
echo "Press any key to close."
read -k 1
