# Suite Observability

Central Prometheus, Loki, and Grafana deployment for Suite. Prometheus and Loki stay inside the Docker network. Caddy exposes Grafana and a write-only Loki push endpoint over HTTPS.

## Prerequisites

- A Linux server with Docker and the Docker Compose plugin.
- DNS for the Grafana domain pointing to the server.
- DNS for a separate log push domain pointing to the server.
- TCP ports 80 and 443 open on the server firewall.
- Each SFU reachable from this server over HTTPS with the same `METRICS_TOKEN`.

## Setup

```bash
cp .env.example .env
mkdir -p secrets
openssl rand -hex 32 > secrets/sfu_metrics_token
# Prometheus must be able to read this bind-mounted file.
PROMETHEUS_IDS="$(docker compose run --rm --no-deps --entrypoint sh prometheus -c 'printf "%s:%s" "$(id -u)" "$(id -g)"')"
sudo chown "$PROMETHEUS_IDS" secrets/sfu_metrics_token
sudo chmod 400 secrets/sfu_metrics_token
```

Set the same token as `METRICS_TOKEN` on every SFU. Edit `.env` with the Grafana domain and a strong admin password. Generate a password with:

```bash
openssl rand -base64 32
```

Generate a separate Loki push password and Caddy hash:

```bash
openssl rand -base64 32
docker run --rm -it caddy:2.10.0-alpine caddy hash-password --algorithm bcrypt
```

Store the plain password in a root-readable `secrets/loki-password` file on each source host. Store only the hash in the monitoring VPS `.env`. Keep the hash single-quoted because it contains dollar signs.

Copy the target template, then list every SFU hostname in the ignored runtime file:

```bash
cp prometheus/targets/sfu.yml.example prometheus/targets/sfu.yml
```

```yaml
- targets:
    - sfu-1.example.com
    - sfu-2.example.com
  labels:
    environment: production
```

Start the stack:

```bash
docker compose config
docker compose up -d
```

On Linux, if the SFU target reports `unable to read authorization credentials`, verify the mounted secret is readable by Prometheus:

```bash
docker compose exec prometheus sh -lc 'cat /run/secrets/sfu_metrics_token >/dev/null && echo readable'
```

Open `https://<GRAFANA_DOMAIN>`, sign in, and use the provisioned Prometheus and Loki data sources. Check scrape health at **Connections > Data sources > Prometheus > Explore** with:

```promql
up{job="frappe-meet-sfu"}
```

Each SFU appears under Prometheus's automatic `instance` label.

## Log collection

Only collect operational logs. Do not log credentials, authorization headers, cookies, session IDs, request bodies, or user-authored content. Keep users, sites, rooms, files, paths, jobs, and correlation IDs in the log body. Never use them as Loki labels.

### Meet host

The SFU deployment includes an optional Alloy profile. Install the same Loki push password used by Caddy:

```bash
cd /opt/meet-sfu
install -d -m 700 secrets
install -m 400 /secure/path/loki-password secrets/loki-password
```

Set `ALLOY_HOST`, `LOKI_PUSH_URL`, and `LOKI_PUSH_USER` in `.env`, then start only Alloy:

```bash
docker compose -f docker-compose.yml -p suite-sfu --env-file .env --profile observability up -d alloy
```

Alloy reads only the `suite-sfu`, `suite-recorder`, and `suite-sfu-nginx` containers. Docker socket access is effectively root access even when the mount is read-only. Keep Alloy pinned, local, and unreachable from the network.

### Frappe host

Use the standalone Compose file in `alloy/`:

```bash
cd suite/meet/observability/alloy
cp .env.example .env
install -d -m 700 secrets
install -m 400 /secure/path/loki-password secrets/loki-password
```

Set the real bench path and stable host name in `.env`. Confirm the allowlisted files in `frappe.alloy` match the production bench, then start Alloy:

```bash
docker compose -f docker-compose.frappe.yml --env-file .env up -d
```

The bench log directory is mounted read-only. Alloy starts at the end of each file on first use, so it does not upload old production history.

### Verify logs

Use Grafana Explore with the Loki data source:

```logql
{environment="production", service="suite-sfu"}
```

```logql
{environment="production", service="suite-recorder"} | json
```

```logql
{environment="production", service=~"frappe-.+"}
```

Review at least 100 lines from every stream before leaving collection enabled. Stop the collector and fix the source if any line contains secrets or user-authored content.

## Local test

Set these values in `.env`:

```env
GRAFANA_DOMAIN=localhost
GRAFANA_ROOT_URL=http://localhost:3001
GRAFANA_PORT=3001
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=local-test-password
PROMETHEUS_RETENTION=7d
LOKI_PUSH_DOMAIN=logs.localhost
LOKI_PUSH_USER=alloy
LOKI_PUSH_PASSWORD_HASH='<valid-caddy-bcrypt-hash>'
```

Put the same local test token in `secrets/sfu_metrics_token` and configure `prometheus/targets/local.yml` to scrape the host machine from Docker:

```yaml
- targets:
    - host.docker.internal:3000
  labels:
    environment: local
    __scheme__: http
```

Start the local SFU so that Docker can reach it:

```bash
cd ../sfu-server
METRICS_TOKEN="$(cat ../observability/secrets/sfu_metrics_token)" HOST=0.0.0.0 yarn dev
```

In another terminal, start Prometheus, Loki, and Grafana. Caddy is not needed locally:

```bash
cd ../observability
docker compose up -d prometheus loki grafana
```

Open Prometheus at `http://localhost:9090/targets` and Grafana at `http://localhost:3001`. The `frappe-meet-sfu` target should be `UP`. Test the Prometheus data source in Grafana Explore with:

```promql
up{job="frappe-meet-sfu"}
```

Stop the local stack with:

```bash
docker compose down
```

## Operations

Prometheus scrapes Loki itself. Check `up{job="loki"}` before debugging a missing log stream.

```bash
docker compose ps
docker compose logs -f prometheus loki grafana caddy
docker compose pull
docker compose up -d
```

Back up the `prometheus-data`, `loki-data`, `grafana-data`, `caddy-data`, and `caddy-config` Docker volumes. Stop the Alloy collectors, then stop Loki while copying `loki-data` so the filesystem backup is consistent. Test restore steps on another volume before relying on the backup.

To rotate the push credential:

1. Generate one new password and hash.
2. Replace the hash in the monitoring VPS `.env`.
3. Replace the plain password file on each source host.
4. Recreate Caddy and both Alloy collectors.
5. Confirm new logs arrive, then discard the old credential.

If the Loki disk fills, stop the Alloy collectors first. Free or extend disk space, start Loki, and then restart the collectors. Do not delete Loki files by hand.

Run `./validate-config.sh` after changing Loki, Caddy, Alloy, or Compose configuration. Do not expose Prometheus port 9090 or Loki port 3100 publicly.

## Error tracking

Use three Sentry projects so ownership, alerting, and releases remain independent:

- Frontend: set `SUITE_FRONTEND_SENTRY_DSN` in the Frappe web process environment.
- Backend: set `FRAPPE_SENTRY_DSN` in the Frappe web and worker process environments.
- SFU: set `SENTRY_DSN` in each SFU deployment.

Enable telemetry in System Settings to permit frontend and backend reporting. Frappe Framework provides backend coverage for Suite requests, background workers, Desk, and errors passed to `frappe.log_error()`. The unified Suite browser application reads its separate frontend DSN at runtime.

The SFU is deployed separately; see `../sfu-server/deploy/.env.example`. Set `SENTRY_RELEASE` to the deployed commit or image version to make regressions actionable. The Suite frontend release defaults to the installed Suite version, while Frappe supplies its own backend release metadata.

Sentry is reserved for unexpected exceptions and process failures. Prometheus remains the source for failure rates and service health, while operational and expected client/WebRTC failures remain in metrics and logs.
