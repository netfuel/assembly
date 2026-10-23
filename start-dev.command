#!/bin/zsh
# Double-click to start the Assembly dev server at http://localhost:5173
cd "$(dirname "$0")"

# Use nvm's Node if it's installed
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Keep node_modules out of Dropbox sync
mkdir -p node_modules
xattr -w com.dropbox.ignored 1 node_modules 2>/dev/null

[ -d node_modules/vite ] || npm install
npm run dev
