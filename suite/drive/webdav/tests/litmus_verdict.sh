#!/usr/bin/env bash
# Read a litmus transcript, compare it with the ledger, print the verdict.
#
#   ./litmus_verdict.sh <ledger> <transcript>
#
# Exit 0 when every group ran and every non-pass is ledgered, 1 otherwise.
#
# Its own file, called by run_litmus.sh, because this is the only part of the
# run that a repository-local test can exercise: it needs a recorded
# transcript, not a served site and not the litmus binary. See
# `TestLitmusVerdict` in suite/drive/tests/test_webdav.py.
#
# A litmus transcript has three line shapes this reads:
#
#   -> running `basic':
#    1. begin................. pass
#   <- summary for `basic': of 2 tests run: 1 passed, 1 failed. 50.0%
#
# and one it must refuse:
#
#   Could not create new collection `/dav/litmus/' for tests: 409 CONFLICT
#
# litmus prints that instead of a verdict line when the MKCOL of its own test
# collection fails, then abandons the group. Gate run 6 printed it five times
# and no case ran. A parser that only looks for FAIL lines reads that silence
# as success, so absence of a verdict is a failure here, never a pass.

set -uo pipefail

LEDGER="${1:?usage: litmus_verdict.sh <ledger> <transcript>}"
OUTPUT="${2:?usage: litmus_verdict.sh <ledger> <transcript>}"

# not `GROUPS`: bash keeps that name for the caller's unix group ids and
# ignores the assignment, so the loop below would check four numbers.
LITMUS_GROUPS=(http basic copymove props locks)

status=0

# --- the ledger: "<group>:<test>:<FIRST-WORD-IS-THE-KIND> reason" -----------
declare -A ledger
if [[ -f "$LEDGER" ]]; then
    while IFS= read -r line; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        IFS=: read -r lgroup ltest lrest <<<"$line"
        # the kind is the first word of the third field; the rest is prose.
        # Reading the whole field as the kind is what made every run report
        # the one ledgered WARNING as stale.
        ledger["$lgroup:$ltest"]="${lrest%% *}"
    done <"$LEDGER"
fi

# --- the transcript: every verdict, pass included --------------------------
declare -A seen
declare -A ran
group=""
while IFS= read -r line; do
    if [[ "$line" == "-> running "* ]]; then
        group="${line#*\`}"
        group="${group%%\'*}"
        ran["$group"]=1
        continue
    fi
    [[ "$line" =~ ^[[:space:]]*[0-9]+[.][[:space:]]+([a-z0-9_]+)[.]*[[:space:]]+(pass|FAIL|WARNING) ]] || continue
    test_name="${BASH_REMATCH[1]}"
    kind="${BASH_REMATCH[2]}"
    seen["$group:$test_name"]="$kind"
    [[ "$kind" == "pass" ]] && continue
    if [[ "${ledger["$group:$test_name"]:-}" != "$kind" ]]; then
        echo "UNLEDGERED $kind: $group:$test_name"
        [[ "$kind" == "FAIL" ]] && status=1
    fi
done <"$OUTPUT"

# --- a group that never started, or stopped in `begin` ---------------------
while IFS= read -r line; do
    echo "ABORTED: $line"
    status=1
done < <(grep -E "^Could not create new collection" "$OUTPUT")

for g in "${LITMUS_GROUPS[@]}"; do
    if [[ -z "${ran["$g"]:-}" ]]; then
        echo "GROUP DID NOT RUN: $g"
        status=1
    elif [[ "${seen["$g:begin"]:-missing}" != "pass" ]]; then
        echo "GROUP DID NOT START: $g (begin: ${seen["$g:begin"]:-no verdict})"
        status=1
    fi
done

# --- stale ledger lines ----------------------------------------------------
# Only a test that ran and passed is stale. A test with no verdict did not
# run, which is a different fault and gets its own message: deleting a ledger
# line on the strength of a group that aborted would drop a real tolerance.
for key in "${!ledger[@]}"; do
    case "${seen["$key"]:-missing}" in
    "${ledger["$key"]}") ;;
    pass)
        echo "STALE LEDGER LINE (now passes): $key:${ledger["$key"]}"
        status=1
        ;;
    missing)
        echo "LEDGERED TEST DID NOT RUN: $key:${ledger["$key"]}"
        status=1
        ;;
    *)
        echo "LEDGERED $key is now ${seen["$key"]}, ledger says ${ledger["$key"]}"
        status=1
        ;;
    esac
done

if [[ $status -eq 0 ]]; then
    echo "litmus: all groups clean"
fi
exit $status
