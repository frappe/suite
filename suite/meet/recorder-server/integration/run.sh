#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../../.." && pwd)
compose="$root/suite/meet/recorder-server/integration/docker-compose.yml"
output="$root/suite/meet/recorder-server/integration/output"

mkdir -p "$output"
docker compose -f "$compose" build recorder-integration
docker compose -f "$compose" run --rm recorder-integration node dist/integration/CaptureWorker.integration.js clean
docker compose -f "$compose" run --rm recorder-integration node dist/integration/CaptureWorker.integration.js recovery
