#!/bin/zsh
# Double-click to load the WYXR concert calendar events (db/import/wyxr.sql) into the live database.
# Safe to run again: events and venues are updated in place and RSVPs are kept.
# To refresh from a newer export: python3 scripts/import-wyxr.py <export.json>, then run this.
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if [ ! -d node_modules/wrangler ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm install || exit 1
fi

npx wrangler whoami 2>/dev/null | grep -q "associated with the email" || npx wrangler login || exit 1

echo ""
head -2 db/import/wyxr.sql | sed 's/^-- //'
echo "Loading into the live database…"
if npx wrangler d1 execute assembly --remote --file=db/import/wyxr.sql --yes; then
  echo ""
  echo "Done. Live counts:"
  npx wrangler d1 execute assembly --remote --command "SELECT (SELECT COUNT(*) FROM events WHERE id LIKE 'wyxr-%') AS wyxr_events, (SELECT COUNT(*) FROM venues WHERE id LIKE 'venue-%') AS venues"
else
  echo ""
  echo "The import didn't finish. Nothing above this line was rolled back automatically; it's safe to run again."
fi
echo ""
echo "Press any key to close."
read -k 1
