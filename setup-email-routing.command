#!/bin/zsh
# Double-click to forward hello@ and support@assembly.rsvp to your inbox with Cloudflare Email Routing.
# Safe to run again: it skips what's already set. Writes a log to email-routing.txt (git-ignored).
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -d node_modules/wrangler ] || npm install || exit 1

DOMAIN=assembly.rsvp
DEST=netfuel@gmail.com
OUT=email-routing.txt
w() { npx wrangler "$@" 2>&1 | grep -v -E "Proxy environment|open beta command|^ ⛅️|^─+$|^$"; }

{
  echo "== Turning on Email Routing for $DOMAIN"
  w email routing enable $DOMAIN

  echo; echo "== Destination $DEST"
  if w email routing addresses list | grep -qi "$DEST"; then
    echo "Already added."
  else
    w email routing addresses create $DEST
    echo "Cloudflare emailed a verification link to $DEST. Forwarding starts once you click it."
  fi

  echo; echo "== Forwarding rules"
  RULES=$(w email routing rules list $DOMAIN)
  for ADDR in hello@$DOMAIN support@$DOMAIN; do
    if echo "$RULES" | grep -qi "$ADDR"; then
      echo "$ADDR: already forwards."
    else
      w email routing rules create $DOMAIN --name "${ADDR%%@*} to inbox" --match-type literal --match-field to \
        --match-value $ADDR --action-type forward --action-value $DEST
    fi
  done

  echo; echo "== Now"
  w email routing settings $DOMAIN
  w email routing rules list $DOMAIN
  w email routing addresses list
} | tee "$OUT"

echo ""
echo "Saved to $OUT. If Cloudflare sent a verification email, click the link in it."
echo "Press any key to close."
read -k 1
