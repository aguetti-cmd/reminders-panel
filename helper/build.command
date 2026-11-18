#!/bin/bash
# Double-click in Finder to build. Runs only read-only checks (version, status).
# It never runs request-access or any write command.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
LOG="$DIR/build.log"

run_all() {
    echo "=== reminders-helper build ==="
    echo "Time: $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "--- sw_vers ---"
    sw_vers || true
    echo "--- build.sh ---"
    if ! ./build.sh; then
        echo "BUILD FAILED"
        return 1
    fi
    local failed=0
    echo "--- reminders-helper version ---"
    if ! ./build/reminders-helper version; then
        failed=1
    fi
    echo "--- reminders-helper status ---"
    if ! ./build/reminders-helper status; then
        failed=1
    fi
    if [ "$failed" = "0" ]; then
        echo "BUILD OK"
        return 0
    fi
    echo "BUILD FAILED"
    return 1
}

set +e
run_all 2>&1 | tee "$LOG"
STATUS="${PIPESTATUS[0]}"
set -e

echo
echo "Log written to: $LOG"
read -r -p "Press Return to close this window." _ || true
exit "$STATUS"
