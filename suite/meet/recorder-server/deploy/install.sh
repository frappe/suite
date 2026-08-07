#!/usr/bin/env bash
set -euo pipefail

repo="frappe/suite"
branch="${1:-develop}"
base_url="https://raw.githubusercontent.com/$repo/$branch/suite/meet/recorder-server/deploy"
install_dir="${RECORDER_INSTALL_DIR:-/opt/meet-recorder}"
files=(docker-compose.yml .env.example Caddyfile deploy.sh)

command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required." >&2; exit 1; }

install -d -m 700 "$install_dir"
for file in "${files[@]}"; do
	curl -fsSL "$base_url/$file" -o "$install_dir/$file"
done
chmod 700 "$install_dir/deploy.sh"

if [[ ! -f "$install_dir/.env" ]]; then
	cp "$install_dir/.env.example" "$install_dir/.env"
	chmod 600 "$install_dir/.env"
fi

echo "Installed to $install_dir"
echo "Configure $install_dir/.env, then run $install_dir/deploy.sh setup"
