#!/usr/bin/env bash
set -euo pipefail

mode=$1
frappe_sha=$2
site=unified.test
export CI=Yes
cd "$HOME"
git -c safe.directory=/source clone --quiet --no-local /source suite
cd suite
corepack pnpm --version
cd "$HOME"
printf '[client]\nskip-ssl\n' > ~/.my.cnf
mariadb --host 127.0.0.1 --port 3306 -u root -proot -e "SET GLOBAL character_set_server = 'utf8mb4'; SET GLOBAL collation_server = 'utf8mb4_unicode_ci'"

start=$SECONDS
if [[ "$mode" == bench ]]; then
  bench --version
  redis-server --port 13000 --daemonize yes
  redis-server --port 11000 --daemonize yes
  git init -q frappe-source
  git -C frappe-source fetch --quiet --depth=1 https://github.com/frappe/frappe.git "$frappe_sha"
  git -C frappe-source checkout --quiet FETCH_HEAD
  bench init --frappe-path "$HOME/frappe-source" --skip-redis-config-generation --skip-assets --python "$(command -v python)" "$HOME/frappe-bench"
  cd "$HOME/frappe-bench"
  git clone --quiet "$HOME/suite" apps/suite
  uv pip install --quiet -e "$PWD/apps/suite" --python "$PWD/env/bin/python"
  (cd apps/suite && corepack pnpm install --frozen-lockfile)
  python -c 'from bench.bench import Bench; Bench(".").apps.sync(app_name="suite", app_dir="suite")'
  bench build --app suite
  bench new-site --db-root-password root --admin-password admin "$site"
  bench --site "$site" install-app suite
  frappe=(bench)
else
  pilot --version
  pilot new frappe-bench --frappe-branch develop
  for setting in 'admin_allow_site_to_pilot_communication false' 'mariadb_existing true' 'mariadb_host 127.0.0.1' 'mariadb_port 3306' 'mariadb_admin_user root' 'mariadb_password root' 'watch_apps_js false' 'lite_mode_enabled false' 'reload_python false'; do
    read -r key value <<< "$setting"
    pilot -b frappe-bench set-bench-config "$key" "$value"
  done
  pilot -b frappe-bench init --commit "$frappe_sha"
  cd "$HOME/pilot/benches/frappe-bench"
  pilot get-app "$HOME/suite" --branch "$(git -C "$HOME/suite" rev-parse HEAD)" --skip-assets
  pilot build --app suite
  pilot start > "$HOME/frappe-start.log" 2>&1 &
  curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 2 http://127.0.0.1:7000/api/v1/health
  pilot new-site "$site" --admin-password admin --apps frappe suite --skip-assets
  frappe=(pilot frappe)
fi

"${frappe[@]}" --site "$site" set-config allow_tests true
"${frappe[@]}" --site "$site" set-config storage_v2 1
"${frappe[@]}" --site "$site" set-config ignore_csrf 1
"${frappe[@]}" --site "$site" set-config host_name "http://$site:8000"
"${frappe[@]}" --site "$site" disable-scheduler
"${frappe[@]}" --site "$site" execute suite.api.account.mark_onboarded

if [[ "$mode" == bench ]]; then
  sed -i 's/^watch:/# watch:/g; s/^schedule:/# schedule:/g' Procfile
  bench start > "$HOME/frappe-start.log" 2>&1 &
fi
trap 'tail -100 "$HOME/frappe-start.log"' ERR
curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 2 "http://$site:8000/api/method/ping"
"${frappe[@]}" --site "$site" execute suite.tests.ci_smoke.enqueue_worker_smoke
timeout 30 bash -c 'until test -f "sites/$1/private/suite-ci-worker-ready"; do sleep 1; done' _ "$site"
test -f apps/suite/suite/www/suite.html
for app in writer sheets slides; do
  test -s "apps/suite/suite/$app/content/dist/checker.cjs"
  test -s "apps/suite/suite/$app/content/dist/converter.cjs"
done
printf '\n%s ready with frontend and working queue after %ds\n' "$mode" "$((SECONDS-start))"
