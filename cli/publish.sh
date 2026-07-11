#!/bin/sh
# Publish the Nalu CLI to the website: copies the CLI + installer into the
# train repo's static dir (client/public), which n4lu.com serves. Deploy the
# train repo afterwards (train/deploy.sh) to make the new version live at
#   https://n4lu.com/install.sh   and   https://n4lu.com/nalu.mjs
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TRAIN="${TRAIN_DIR:-$HOME/train}"
DEST="$TRAIN/client/public"
[ -d "$DEST" ] || { echo "train repo not found at $TRAIN (set TRAIN_DIR to override)"; exit 1; }
node --check "$HERE/nalu.mjs"
cp "$HERE/nalu.mjs" "$DEST/nalu.mjs"
cp "$HERE/install.sh" "$DEST/install.sh"
VER=$(grep -o "const VERSION = '[^']*'" "$HERE/nalu.mjs" | head -1 | cut -d"'" -f2)
echo "published Nalu CLI v$VER -> $DEST (deploy train to go live)"
