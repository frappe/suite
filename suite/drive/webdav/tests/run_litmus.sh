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
# only grow from real runs.
#
# THIS SUITE CANNOT PASS ON THE TICKET-24 RELEASE. Only OPTIONS, GET, HEAD and
# PROPFIND are relinked to `Drive Node`; every write verb answers 405 until
# ticket 25. litmus writes before it reads in every group, so basic, copymove,
# props and locks all fail. Do not ledger those failures — see the note at the
# top of litmus_expected.txt. Run this for real when ticket 25 lands.

set -euo pipefail

SITE="${1:?usage: run_litmus.sh <site> [litmus-binary]}"
LITMUS="${2:-litmus}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LEDGER="$HERE/litmus_expected.txt"

command -v "$LITMUS" >/dev/null || { echo "litmus binary not found: $LITMUS"; exit 2; }

cat >&2 <<'BANNER'
WARNING: WebDAV write verbs are gated to ticket 25 (PUT, MKCOL, DELETE, MOVE,
COPY, LOCK, UNLOCK, PROPPATCH all answer 405). The basic, copymove, props and
locks groups are expected to fail. Do not add those failures to the ledger.
BANNER

URL="$(bench --site "$SITE" execute suite.drive.webdav.tests.litmus_setup.prepare | tail -1 | tr -d '"')"
echo "litmus target: $URL"

OUTPUT="$(mktemp)"
trap 'bench --site "$SITE" execute suite.drive.webdav.tests.litmus_setup.teardown >/dev/null; rm -f "$OUTPUT"' EXIT

# tr: litmus rewrites progress with \r; split those into real lines so the
# anchored matchers below see the final verdict on its own line
"$LITMUS" -k "$URL" "litmus@example.com" "litmus-ci-password" | tr '\r' '\n' | tee "$OUTPUT" || true

status=0
group=""
while IFS= read -r line; do
    case "$line" in
        "-> running "*) group="$(echo "$line" | sed "s/.*\`\(.*\)'.*/\1/")" ;;
        *". "*"FAIL"*|*". "*"WARNING"*)
            test_name="$(echo "$line" | sed -E 's/^ *[0-9]+\. ([a-z0-9_]+).*/\1/')"
            kind="FAIL"; [[ "$line" == *WARNING* ]] && kind="WARNING"
            if ! grep -q "^$group:$test_name:$kind" "$LEDGER" 2>/dev/null; then
                echo "UNLEDGERED $kind: $group:$test_name"
                [[ "$kind" == "FAIL" ]] && status=1
            fi
            ;;
    esac
done < "$OUTPUT"

# stale ledger lines (entries that now pass) must be removed
if [[ -f "$LEDGER" ]]; then
    while IFS=: read -r lgroup ltest lkind _; do
        [[ -z "$lgroup" || "$lgroup" == \#* ]] && continue
        if ! grep -E "^ *[0-9]+\. $ltest.*($lkind)" "$OUTPUT" >/dev/null; then
            echo "STALE LEDGER LINE (now passes): $lgroup:$ltest:$lkind"
            status=1
        fi
    done < "$LEDGER"
fi

if grep -q "0 failed" "$OUTPUT" && [[ $status -eq 0 ]]; then
    echo "litmus: all groups clean"
fi
exit $status
