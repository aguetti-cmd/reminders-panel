#!/bin/bash
# Builds build/reminders-helper. Set UNIVERSAL=1 to also build x86_64 and merge.
# This script never deletes anything. It only overwrites its own build output.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if ! command -v xcrun >/dev/null 2>&1 || ! SWIFTC="$(xcrun --find swiftc 2>/dev/null)"; then
    echo "swiftc was not found." >&2
    echo "Install the Xcode Command Line Tools first by running: xcode-select --install" >&2
    exit 1
fi
SDK="$(xcrun --sdk macosx --show-sdk-path)"

mkdir -p build
SOURCES=(Sources/*.swift)
COMMON_FLAGS=(
    -O
    -swift-version 5
    -module-name RemindersHelper
    -sdk "$SDK"
    -framework EventKit
    -framework CoreGraphics
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$DIR/Info.plist"
)

echo "Using swiftc: $SWIFTC"
echo "Building arm64..."
"$SWIFTC" "${COMMON_FLAGS[@]}" -target arm64-apple-macos13.0 "${SOURCES[@]}" -o build/reminders-helper-arm64

if [ "${UNIVERSAL:-0}" = "1" ]; then
    echo "Building x86_64..."
    "$SWIFTC" "${COMMON_FLAGS[@]}" -target x86_64-apple-macos13.0 "${SOURCES[@]}" -o build/reminders-helper-x86_64
    echo "Merging with lipo..."
    lipo -create build/reminders-helper-arm64 build/reminders-helper-x86_64 -output build/reminders-helper
else
    cp build/reminders-helper-arm64 build/reminders-helper
fi

echo "Signing (ad-hoc)..."
codesign --force --sign - --identifier local.reminders-panel.helper build/reminders-helper

echo "Built: $DIR/build/reminders-helper"
