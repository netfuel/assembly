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

# First run: create the local database and load the Memphis sample events
if [ ! -d .wrangler/state/v3/d1 ]; then
  echo "Setting up the local database…"
  npm run setup:local || exit 1
fi

# Fonts are gitignored (license); the app still runs on fallbacks without them
npm run --silent check:fonts || echo "Continuing with fallback fonts. See README, Fonts."

npm run dev
