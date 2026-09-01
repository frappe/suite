#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../../.." && pwd)
compose="$root/suite/meet/recorder-server/integration/docker-compose.yml"
output="$root/suite/meet/recorder-server/integration/output"

mkdir -p "$output"
# Linux bind mounts retain the host runner's UID, while the image runs as UID 1000.
chmod o+rwx "$output"

make_output_readable() {
	docker compose -f "$compose" run --rm --no-deps --user root \
		--entrypoint chmod recorder-integration -R a+rX /output || true
	docker compose -f "$compose" down --volumes --remove-orphans || true
}
trap make_output_readable EXIT

run_scenario() {
	docker compose -f "$compose" run --rm recorder-integration \
		timeout --signal=TERM --kill-after=15s "${SCENARIO_TIMEOUT_SECONDS:-180}s" \
		node "$@"
}

# Build both current source trees instead of allowing Compose to reuse a stale SFU tag.
docker compose -f "$compose" build sfu recorder-integration
if [ "${1:-all}" = "shared-stage" ]; then
	run_scenario dist/integration/RecorderSharedStage.integration.js
else
	run_scenario dist/integration/CaptureWorker.integration.js clean
	run_scenario dist/integration/CaptureWorker.integration.js recovery
	run_scenario dist/integration/RecorderSharedStage.integration.js
fi
