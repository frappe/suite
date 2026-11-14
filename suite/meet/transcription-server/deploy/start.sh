#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# Read Compose's resolved configuration, never source an executable .env file.
config=$(docker compose config --format json)
cache=$(python3 -c 'import json,sys; c=json.load(sys.stdin); print(next(v["source"] for v in c["services"]["transcription"]["volumes"] if v["target"] == "/models"))' <<< "$config")
mount=$(docker compose config --environment | sed -n 's/^TRANSCRIPTION_CACHE_MOUNT=//p')
if [[ -z "$mount" ]] || ! mountpoint -q -- "$mount"; then
    echo "Model cache mount is unavailable; refusing to start." >&2
    exit 1
fi
cache=$(realpath -e -- "$cache")
mount=$(realpath -e -- "$mount")
if [[ "$mount" == / ]]; then
    echo "Model cache must use a separate mounted filesystem." >&2
    exit 1
fi
if [[ "$cache" != "$mount" && "$cache" != "$mount/"* ]]; then
    echo "Model cache must be on the configured mounted filesystem." >&2
    exit 1
fi
# Never initialize another Docker daemon or alter host networking here.
docker info >/dev/null
docker compose up -d --build "$@"
