#!/usr/bin/env bash
# Runs each test file of one Suite module separately and writes a JUnit report per
# file to test-results/<module>/. Run it from the bench directory.
# Usage: run_module_tests.sh <module>
set -uo pipefail

module_name="$1"
results="$GITHUB_WORKSPACE/test-results/$module_name"
mkdir -p "$results"

status=0
for path in "$GITHUB_WORKSPACE"/suite/"$module_name"/tests/test_*.py; do
	[ -e "$path" ] || continue
	rel="${path#"$GITHUB_WORKSPACE"/}"
	module="$(echo "${rel%.py}" | tr / .)"
	echo "::group::$module"
	if ! pilot frappe --site test_site run-tests --module "$module" --junit-xml-output "${results:?}/${module:?}-fragments.xml"; then
		status=1
	fi
	python "$GITHUB_WORKSPACE/.github/scripts/merge_junit.py" "${results:?}/${module:?}-fragments.xml" "${results:?}/${module:?}.xml"
	rm "${results:?}/${module:?}-fragments.xml"
	echo "::endgroup::"
done
exit "$status"
