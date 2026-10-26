#!/bin/zsh
# Double-click to put the Timeless fonts in R2: the WOFF2s the app uses, and the static cuts that
# link-preview images are drawn with (fonts-og/, made by scripts/make-og-fonts.py). Run again only if the fonts change.
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if [ ! -d node_modules/wrangler ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm install || exit 1
fi

npx wrangler whoami 2>/dev/null | grep -q "associated with the email" || npx wrangler login || exit 1

if [ ! -f fonts-og/TimelessSerif-Light.ttf ]; then
  python3 scripts/make-og-fonts.py || echo "Couldn't make the preview fonts (pip install fonttools brotli). Uploading the rest."
fi

npm run fonts:upload
echo ""
echo "Press any key to close."
read -k 1
