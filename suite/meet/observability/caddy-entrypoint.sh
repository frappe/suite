#!/bin/sh

set -eu

case "${LOKI_PUSH_ENABLED:-false}" in
    true)
        : "${LOKI_PUSH_USER:?set LOKI_PUSH_USER when LOKI_PUSH_ENABLED=true}"
        : "${LOKI_PUSH_PASSWORD_HASH:?set LOKI_PUSH_PASSWORD_HASH when LOKI_PUSH_ENABLED=true}"
        ;;
    false)
        export LOKI_PUSH_USER="disabled"
        export LOKI_PUSH_PASSWORD_HASH='$2a$14$t12kn9g6DAthRZnk/NOGjerm7r1rG5oqp4tjDX.ccRdleSn/ZZxzW'
        ;;
    *)
        echo "LOKI_PUSH_ENABLED must be true or false" >&2
        exit 1
        ;;
esac

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
