#!/bin/bash
# Copies build/reminders-helper to ~/Library/Application Support/RemindersPanel/.
# An existing binary is first copied to a timestamped backup. Nothing is deleted.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$DIR/build/reminders-helper"
DEST_DIR="$HOME/Library/Application Support/RemindersPanel"
DEST="$DEST_DIR/reminders-helper"

if [ ! -f "$SRC" ]; then
    echo "No build found at $SRC. Run ./build.sh first." >&2
    exit 1
fi

mkdir -p "$DEST_DIR"

if [ -e "$DEST" ]; then
    BACKUP="$DEST_DIR/reminders-helper.backup-$(date +%Y%m%d-%H%M%S)"
    cp -p "$DEST" "$BACKUP"
    echo "Backup of the old binary: $BACKUP"
fi

# Copy to a temporary name, then rename over the old file. Writing into the
# old file in place can make macOS reject the new code signature.
TMP="$DEST_DIR/reminders-helper.installing-$$"
cp "$SRC" "$TMP"
chmod 755 "$TMP"
mv -f "$TMP" "$DEST"

echo "Installed: $DEST"
