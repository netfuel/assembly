#!/bin/zsh
# Double-click to start Assembly at http://localhost:5173 (app, API, and local database).
# Also prints a Network URL so you can open it on your phone on the same Wi-Fi.
cd "$(dirname "$0")"

# Use nvm's Node if it's installed
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Keep generated folders out of Dropbox sync
for dir in node_modules .wrangler dist; do
  mkdir -p "$dir"
  xattr -w com.dropbox.ignored 1 "$dir" 2>/dev/null
done

# Install when dependencies are missing or package-lock.json changed since the last install
if [ ! -d node_modules/vite ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies…"
  npm install || exit 1
fi

# Local database: apply any new migrations (safe to repeat), and load sample events if it's empty
npm run --silent db:migrate:local >/dev/null 2>&1 || { echo "Couldn't update the local database."; exit 1; }
if ! npx wrangler d1 execute assembly --local --command "SELECT 1 FROM events LIMIT 1" 2>/dev/null | grep -q '"1"'; then
  echo "Loading sample events…"
  npm run --silent db:seed:local >/dev/null || exit 1
fi

# Fonts are gitignored (license); the app still runs on fallbacks without them
npm run --silent check:fonts || echo "Continuing with fallback fonts. See README, Fonts."

npm run dev
