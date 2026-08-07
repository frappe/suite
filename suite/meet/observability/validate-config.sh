#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SFU_DEPLOY_DIR="$SCRIPT_DIR/../sfu-server/deploy"
TEST_HASH='$2a$14$B28NG7UTkSTQFMM/Fly87.LUrKQTceAYHvLY0sTYoIJ.XU7qZ39qG'
ALLOY_IMAGE='grafana/alloy:v1.18.1@sha256:0f4434c92b3e6cdac38bb129b344e1790c246f7b6e2eaffcc16a5fa363240e33'
VALIDATION_SECRET="$SCRIPT_DIR/secrets/sfu_metrics_token"
VALIDATION_SECRET_CREATED=false

if [[ ! -f "$VALIDATION_SECRET" ]]; then
  : > "$VALIDATION_SECRET"
  VALIDATION_SECRET_CREATED=true
fi

cleanup() {
  if [[ "$VALIDATION_SECRET_CREATED" == true ]]; then
    rm -f "$VALIDATION_SECRET"
  fi
}

trap cleanup EXIT

export LOKI_PUSH_PASSWORD_HASH="$TEST_HASH"

compose=(docker compose --project-directory "$SCRIPT_DIR" --env-file "$SCRIPT_DIR/.env.example")

"${compose[@]}" config >/dev/null
"${compose[@]}" run --rm --no-deps --entrypoint /bin/promtool prometheus \
  check config /etc/prometheus/prometheus.yml
"${compose[@]}" run --rm --no-deps loki \
  -config.file=/etc/loki/loki.yml \
  -verify-config=true
"${compose[@]}" run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

alloy_validate() {
  local config="$1"

  docker run --rm \
    -e ALLOY_ENVIRONMENT=production \
    -e ALLOY_HOST=validation \
    -e LOKI_PUSH_URL=https://logs.example.com/loki/api/v1/push \
    -e LOKI_PUSH_USER=alloy \
    -v "$config:/etc/alloy/config.alloy:ro" \
    -v /dev/null:/run/secrets/loki-password:ro \
    "$ALLOY_IMAGE" \
    validate --stability.level=generally-available /etc/alloy/config.alloy
}

alloy_validate "$SFU_DEPLOY_DIR/alloy/sfu.alloy"
alloy_validate "$SCRIPT_DIR/alloy/frappe.alloy"

docker compose \
  -f "$SFU_DEPLOY_DIR/docker-compose.yml" \
  --env-file "$SFU_DEPLOY_DIR/.env.example" \
  --profile observability \
  config >/dev/null
docker compose \
  -f "$SCRIPT_DIR/alloy/docker-compose.frappe.yml" \
  --env-file "$SCRIPT_DIR/alloy/.env.example" \
  config >/dev/null

echo "Observability configuration is valid."
