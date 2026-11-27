#!/usr/bin/env bash
set -euo pipefail

# Older runner images and GitHub-hosted fork jobs need the same Pilot release.
pilot_version=v1.0.0-rc.5
export PATH="$HOME/pilot/bin:$HOME/.local/bin:$PATH"
if [[ "$(pilot --version 2>/dev/null || true)" != "pilot $pilot_version" ]]; then
  curl -fsSL https://raw.githubusercontent.com/frappe/pilot/develop/install.sh | sh -s -- --ci --version "$pilot_version"
fi
printf '%s\n' "$HOME/pilot/bin" "$HOME/.local/bin" >> "$GITHUB_PATH"

pilot new frappe-bench --frappe-branch develop
pilot -b frappe-bench set-bench-config admin_allow_site_to_pilot_communication false
pilot -b frappe-bench set-bench-config mariadb_existing true
pilot -b frappe-bench set-bench-config mariadb_host 127.0.0.1
pilot -b frappe-bench set-bench-config mariadb_port 3306
pilot -b frappe-bench set-bench-config mariadb_admin_user root
pilot -b frappe-bench set-bench-config mariadb_password root
pilot -b frappe-bench set-bench-config watch_apps_js false
pilot -b frappe-bench set-bench-config lite_mode_enabled false
pilot -b frappe-bench set-bench-config reload_python false
pilot -b frappe-bench init

cd "$HOME/pilot/benches/frappe-bench"
CI=Yes pilot get-app "$GITHUB_WORKSPACE" --branch "$(git -C "$GITHUB_WORKSPACE" rev-parse HEAD)" --skip-assets
CI=Yes pilot build --app suite
printf '[client]\nskip-ssl\n' > "$HOME/.my.cnf"
mariadb --host 127.0.0.1 --port 3306 -u root -proot -e "
  SET GLOBAL character_set_server = 'utf8mb4';
  SET GLOBAL collation_server = 'utf8mb4_unicode_ci';
"

pilot start > "$RUNNER_TEMP/pilot.log" 2>&1 &
curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 2 \
  http://127.0.0.1:7000/api/v1/health
