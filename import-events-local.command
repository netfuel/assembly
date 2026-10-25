#!/bin/zsh
# Double-click to load the WYXR concert calendar events (db/import/wyxr.sql) into your LOCAL
# database, the one start-dev.command uses. Doesn't touch the live site. Safe to run again.
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if [ ! -d node_modules/wrangler ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm install || exit 1
fi

# Make sure the local database exists and is up to date first.
npm run --silent db:migrate:local >/dev/null 2>&1 || { echo "Couldn't set up the local database."; read -k 1; exit 1; }

echo ""
head -2 db/import/wyxr.sql | sed 's/^-- //'
echo "Loading into the local database…"
if npx wrangler d1 execute assembly --local --file=db/import/wyxr.sql; then
  echo ""
  npx wrangler d1 execute assembly --local --command "SELECT (SELECT COUNT(*) FROM events WHERE id LIKE 'wyxr-%') AS wyxr_events, (SELECT COUNT(*) FROM events WHERE is_sample = 1) AS sample_events"
  echo ""
  echo "Done. Reload the app to see them. Sample events are still there; run npm run db:seed:local to refresh them."
else
  echo ""
  echo "The import didn't finish. It's safe to run again."
fi
echo ""
echo "Press any key to close."
read -k 1
