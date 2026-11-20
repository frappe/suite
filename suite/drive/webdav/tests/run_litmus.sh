#!/usr/bin/env bash
# Run the litmus WebDAV compliance suite against a bench site.
#
#   ./run_litmus.sh <site> [litmus-binary]
#
# Prerequisites: the bench web server is running and reachable at the site's
# URL, and `litmus` is installed (apt install litmus, or built from source —
# https://notroj.github.io/litmus/). All five groups run: http, basic,
# copymove, props, locks.
#
# Results are compared against litmus_expected.txt, one tolerated non-pass per
# line ("<group>:<test>:<FAIL|WARNING> reason"). CI fails on any unledgered
# FAIL and on stale ledger lines that now pass. The ledger ships empty and may
# only grow from real runs. litmus_verdict.sh does that comparison.
#
# Ticket 25 put every method litmus needs on the wire: PUT, MKCOL, DELETE,
# MOVE, COPY, LOCK, UNLOCK and PROPPATCH all answer from `Drive Node`, and
# OPTIONS advertises "DAV: 1, 2, 3". All five groups can therefore be
# attempted.

set -euo pipefail

SITE="${1:?usage: run_litmus.sh <site> [litmus-binary]}"
LITMUS="${2:-litmus}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LEDGER="$HERE/litmus_expected.txt"

command -v "$LITMUS" >/dev/null || { echo "litmus binary not found: $LITMUS"; exit 2; }

OUTPUT="$(mktemp)"

# The trap is installed before `prepare`, not after it. `prepare` writes the
# user, the password, the Personal Root and the per-user opt-in before it
# commits, so a `prepare` that raises part-way used to leave every one of them
# on the site with no teardown. A function body, not `;`-joined commands: under
# `set -e` a failing first command skips the rest of the trap.
cleanup() {
    local rc=$?
    bench --site "$SITE" execute suite.drive.webdav.tests.litmus_setup.teardown >/dev/null ||
        echo "WARNING: litmus teardown failed; site fixtures may remain" >&2
    rm -f "$OUTPUT"
    return $rc
}
trap cleanup EXIT

URL="$(bench --site "$SITE" execute suite.drive.webdav.tests.litmus_setup.prepare | tail -1 | tr -d '"')"
[[ "$URL" == http://* || "$URL" == https://* ]] || { echo "prepare did not return a URL: $URL"; exit 2; }
echo "litmus target: $URL"

# tr: litmus rewrites progress with \r; split those into real lines so the
# anchored matchers in litmus_verdict.sh see the final verdict on its own line.
set +e
"$LITMUS" -k "$URL" "litmus@example.com" "litmus-ci-password" 2>&1 | tr '\r' '\n' | tee "$OUTPUT"
litmus_rc=${PIPESTATUS[0]}
set -e
echo "litmus exit status: $litmus_rc"

"$HERE/litmus_verdict.sh" "$LEDGER" "$OUTPUT"
