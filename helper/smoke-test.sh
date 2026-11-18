#!/bin/bash
# Read-only checks against a built binary. Never creates or changes a reminder
# or event, and never calls request-access.
# Usage: ./smoke-test.sh [path-to-binary]   (default: build/reminders-helper)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${1:-$DIR/build/reminders-helper}"

if [ ! -x "$BIN" ]; then
    echo "No executable at $BIN. Run ./build.sh first." >&2
    exit 1
fi

FAILS=0

# check NAME EXPECTED_EXIT EXPECTED_TEXT ARGS...
check() {
    local name="$1"
    local want_exit="$2"
    local want_text="$3"
    shift 3
    local out
    local code
    if out="$("$BIN" "$@" 2>/dev/null)"; then
        code=0
    else
        code=$?
    fi
    if [ "$code" = "$want_exit" ] && printf '%s' "$out" | grep -q -F "$want_text"; then
        echo "PASS  $name"
    else
        echo "FAIL  $name (exit $code)"
        echo "      output: $out"
        FAILS=$((FAILS + 1))
    fi
}

check "version"                        0 '"ok":true'                version
check "status"                         0 '"ok":true'                status
check "snapshot daysAhead 3"           0 '"daysAhead":3'            snapshot '{"daysAhead":3}'
check "unknown command"                1 '"code":"invalid_input"'   no-such-command
check "payload is not JSON"            1 '"code":"invalid_input"'   snapshot 'this is not json'
check "reminder-update without id"     1 '"code":"invalid_input"'   reminder-update '{}'

echo
if [ "$FAILS" = "0" ]; then
    echo "All smoke tests passed."
    exit 0
fi
echo "$FAILS smoke test(s) failed."
exit 1
