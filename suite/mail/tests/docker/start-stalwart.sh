#!/usr/bin/env bash
# Boots a bootstrapped Stalwart server for the mail/calendar integration tests.
# Mirrors the production sequence in suite/mail/utils/ansible/playbooks/deploy-mail-server.yml:
# start container -> wait for :8080 -> stalwart-cli apply bootstrap.ndjson -> restart -> wait.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STALWART_VERSION="${STALWART_VERSION:-v0.16.17}"
STALWART_CLI_VERSION="${STALWART_CLI_VERSION:-v1.0.12}"
STALWART_ADMIN_USER="${STALWART_ADMIN_USER:-admin}"
STALWART_ADMIN_PASSWORD="${STALWART_ADMIN_PASSWORD:-admin}"
STALWART_HTTP_PORT="${STALWART_HTTP_PORT:-8080}"
STALWART_URL="http://127.0.0.1:${STALWART_HTTP_PORT}"

export STALWART_VERSION STALWART_ADMIN_USER STALWART_ADMIN_PASSWORD STALWART_HTTP_PORT

wait_for_http() {
    # Any HTTP response counts as reachable: in bootstrap mode the server answers with an
    # error status on most paths, so only connection failures should keep us waiting.
    for _ in $(seq 1 90); do
        if curl -s -o /dev/null "$STALWART_URL"; then
            return 0
        fi
        sleep 2
    done
    echo "Stalwart did not become reachable at $STALWART_URL" >&2
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" logs stalwart >&2 || true
    return 1
}

download_stalwart_cli() {
    local arch os_id fallback_os_id base_url tmpdir

    case "$(uname -m)" in
        x86_64 | amd64) arch="x86_64" ;;
        aarch64 | arm64) arch="aarch64" ;;
        *)
            echo "Unsupported architecture '$(uname -m)' for stalwart-cli download." >&2
            return 1
            ;;
    esac

    case "$(uname -s)" in
        Linux)
            os_id="unknown-linux-gnu"
            fallback_os_id="unknown-linux-musl"
            ;;
        Darwin)
            os_id="apple-darwin"
            fallback_os_id=""
            ;;
        *)
            echo "Unsupported operating system '$(uname -s)' for stalwart-cli download." >&2
            return 1
            ;;
    esac

    if [ "$STALWART_CLI_VERSION" = "latest" ]; then
        base_url="https://github.com/stalwartlabs/cli/releases/latest/download"
    else
        base_url="https://github.com/stalwartlabs/cli/releases/download/${STALWART_CLI_VERSION}"
    fi

    tmpdir="$(mktemp -d)"
    if ! curl -fsSL "${base_url}/stalwart-cli-${arch}-${os_id}.tar.xz" | tar -xJ -C "$tmpdir"; then
        if [ -n "$fallback_os_id" ]; then
            curl -fsSL "${base_url}/stalwart-cli-${arch}-${fallback_os_id}.tar.xz" | tar -xJ -C "$tmpdir"
        else
            return 1
        fi
    fi

    STALWART_CLI="$(find "$tmpdir" -type f -name stalwart-cli | head -1)"
    if [ -z "$STALWART_CLI" ]; then
        echo "Downloaded archive does not contain a 'stalwart-cli' binary." >&2
        return 1
    fi
    chmod +x "$STALWART_CLI"
}

docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d
wait_for_http

download_stalwart_cli

# Tolerate an already-bootstrapped server (same condition as the deploy playbook).
set +e
apply_output="$(
    STALWART_URL="$STALWART_URL" \
    STALWART_USER="$STALWART_ADMIN_USER" \
    STALWART_PASSWORD="$STALWART_ADMIN_PASSWORD" \
        "$STALWART_CLI" apply --file "$SCRIPT_DIR/bootstrap.ndjson" --json 2>&1
)"
apply_rc=$?
set -e
echo "$apply_output"
if [ $apply_rc -ne 0 ] && ! echo "$apply_output" | grep -q "This operation is only allowed bootstrap mode"; then
    echo "Bootstrap apply failed." >&2
    exit 1
fi

docker compose -f "$SCRIPT_DIR/docker-compose.yml" restart stalwart
wait_for_http

echo "Stalwart is ready at $STALWART_URL (admin: $STALWART_ADMIN_USER)"
