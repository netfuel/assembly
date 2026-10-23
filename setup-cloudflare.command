#!/bin/zsh
# Double-click once to create Assembly's Cloudflare database, session store, and media bucket.
# Safe to run again. See scripts/setup-cloudflare.mjs for exactly what it does.
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if [ ! -d node_modules/wrangler ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm install || exit 1
fi

npm run setup:cloudflare
echo ""
echo "Press any key to close."
read -k 1
