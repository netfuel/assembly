#!/bin/zsh
# Double-click to check (and if needed, turn on) Cloudflare Email Sending for assembly.rsvp.
# Writes what it finds to email-check.txt in this folder (git-ignored) so it's easy to share.
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -d node_modules/wrangler ] || npm install || exit 1

OUT=email-check.txt
{
  echo "== Account"; npx wrangler whoami 2>&1 | grep -iE "account|email|logged" | grep -v "token"
  echo; echo "== Sending domains on this account"; npx wrangler email sending list 2>&1
  echo; echo "== assembly.rsvp sending settings"; npx wrangler email sending settings assembly.rsvp 2>&1
  echo; echo "== assembly.rsvp sending DNS records"; npx wrangler email sending dns get assembly.rsvp 2>&1
} | grep -v "Proxy environment" | tee "$OUT"

echo ""
if grep -qiE "not found|not enabled|disabled|no sending|10000|error" "$OUT"; then
  read -q "REPLY?Turn on Email Sending for assembly.rsvp now? (y/n) " && echo && {
    npx wrangler email sending enable assembly.rsvp 2>&1 | tee -a "$OUT"
    echo; echo "== After enabling" | tee -a "$OUT"
    npx wrangler email sending settings assembly.rsvp 2>&1 | tee -a "$OUT"
  }
fi
echo ""
echo "Saved to $OUT. Press any key to close."
read -k 1
