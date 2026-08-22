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
}
trap make_output_readable EXIT

docker compose -f "$compose" build recorder-integration
docker compose -f "$compose" run --rm recorder-integration node dist/integration/CaptureWorker.integration.js clean
docker compose -f "$compose" run --rm recorder-integration node dist/integration/CaptureWorker.integration.js recovery
