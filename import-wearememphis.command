#!/bin/zsh
# Double-click to load the We Are Memphis + Overton Park Shell events (db/import/wearememphis.sql) into the
# live database, with their artwork. Safe to run again: events and venues are updated in place, RSVPs are
# kept, and artwork already in R2 is skipped.
# To refresh from a newer scrape: python3 scripts/import-wearememphis.py <scrape.json>, then run this.
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if [ ! -d node_modules/wrangler ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm install || exit 1
fi

npx wrangler whoami 2>/dev/null | grep -q "associated with the email" || npx wrangler login || exit 1

BUCKET=assembly-media
ART=db/import/artwork
MANIFEST=db/import/wearememphis-artwork.tsv
mkdir -p "$ART"

echo ""
head -2 db/import/wearememphis.sql | sed 's/^-- //'

# 1. Artwork: download each flyer, fit it inside 2000 px, make a 160 px square thumbnail, upload both.
#    Keys are listed in the manifest the Python script wrote. Already-uploaded keys are skipped (.done marker).
total=$(wc -l < "$MANIFEST" | tr -d ' ')
n=0; up=0; skip=0; fail=0
echo ""
echo "Artwork: $total images"
while IFS=$'\t' read -r id url key; do
  n=$((n+1))
  [ -z "$key" ] && continue
  ext="${key##*.}"
  file="$ART/$id.$ext"
  thumb="$ART/$id.thumb.jpg"
  if [ -f "$ART/$id.done" ]; then skip=$((skip+1)); continue; fi
  printf '  [%3d/%3d] %s ' "$n" "$total" "$id"
  if ! curl -fsSL --retry 2 -A "Mozilla/5.0 (Assembly importer; hello@assembly.rsvp)" -o "$file" "$url"; then
    echo "download failed"; fail=$((fail+1)); continue
  fi
  # Fit inside 2000 px (same limit the app applies to uploads), then a centered 160 px square for map pins.
  sips -Z 2000 "$file" >/dev/null 2>&1
  w=$(sips -g pixelWidth "$file" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$file" | awk '/pixelHeight/{print $2}')
  side=$(( w < h ? w : h ))
  sips -s format jpeg -s formatOptions 80 -c "$side" "$side" "$file" --out "$thumb" >/dev/null 2>&1 && sips -Z 160 "$thumb" >/dev/null 2>&1
  ctype="image/jpeg"; [ "$ext" = "png" ] && ctype="image/png"
  if npx wrangler r2 object put "$BUCKET/$key" --remote --file "$file" --content-type "$ctype" --cache-control "public, max-age=31536000, immutable" >/dev/null 2>&1 \
     && npx wrangler r2 object put "$BUCKET/$key.thumb" --remote --file "$thumb" --content-type "image/jpeg" --cache-control "public, max-age=31536000, immutable" >/dev/null 2>&1; then
    touch "$ART/$id.done"; up=$((up+1)); echo "ok (${w}x${h})"
  else
    echo "upload failed"; fail=$((fail+1))
  fi
done < "$MANIFEST"
echo "  uploaded $up, already there $skip, failed $fail"
if [ "$fail" -gt 0 ]; then
  echo ""
  echo "Some artwork didn't make it. Run this again to retry just those; the events below will still load,"
  echo "and an event whose flyer is missing shows a plain pin until its image arrives."
fi

# 2. Events and venues.
echo ""
echo "Loading into the live database…"
if npx wrangler d1 execute assembly --remote --file=db/import/wearememphis.sql --yes; then
  echo ""
  echo "Done. Live counts:"
  npx wrangler d1 execute assembly --remote --command "SELECT (SELECT COUNT(*) FROM events WHERE id LIKE 'wam-%') AS wam_events, (SELECT COUNT(*) FROM events WHERE id LIKE 'wyxr-%' AND flyer_key IS NOT NULL) AS wyxr_with_art, (SELECT COUNT(*) FROM venues) AS venues"
else
  echo ""
  echo "The import didn't finish. Nothing above this line was rolled back automatically; it's safe to run again."
fi
echo ""
echo "Press any key to close."
read -k 1
