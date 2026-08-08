# Suite Observability

Central Prometheus, Loki, and Grafana deployment for Suite. Prometheus and Loki stay inside the Docker network. Caddy exposes Grafana and an authenticated Loki push path on the same HTTPS hostname.

## Prerequisites

- A Linux server with Docker and the Docker Compose plugin.
- DNS for the Grafana domain pointing to the server.
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

Set `LOKI_PUSH_ENABLED=true` only after the user and hash are present. Caddy refuses partial enabled configuration. Alloy sends logs to `https://<GRAFANA_DOMAIN>/loki/api/v1/push`; no second DNS record is required.

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

Only collect operational logs. Do not log credentials, authorization headers, cookies, session IDs, request bodies, or user-authored content. Keep users, sites, rooms, files, paths, jobs, and correlation IDs in the log body. Never use them as Loki labels. Alloy redacts several common secret formats, but it cannot prove a log line is safe. Review each source before enabling it.

### Meet host

The SFU deployment includes an optional Alloy profile. Install the same Loki push password used by Caddy:

```bash
cd /opt/meet-sfu
install -d -m 700 secrets
install -m 400 /secure/path/loki-password secrets/loki-password
```

Set a unique `ALLOY_HOST`, `LOKI_PUSH_URL`, and `LOKI_PUSH_USER` in `.env`, then start only Alloy:

```env
LOKI_PUSH_URL=https://metrics.example.com/loki/api/v1/push
```

```bash
./deploy.sh observability-start
```

Alloy reads only the `suite-sfu`, `suite-recorder`, and `suite-sfu-nginx` containers. Docker socket access is effectively root access even when the mount is read-only. Keep Alloy pinned, local, and unreachable from the network.

### Self-hosted Frappe bench

Use the standalone Compose file in `alloy/` only when you control the bench host and can mount its log directory:

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

The bench log directory is mounted read-only. Alloy starts at the end of each file on first use, so it does not upload old production history. Plain Frappe log lines keep their collection time because their timestamps have no time zone. Structured monitor timestamps are parsed when they include an offset.

### Frappe Cloud sites

Do not deploy the Frappe Alloy file collector for sites hosted on Frappe Cloud. Frappe Cloud already provides managed Logs, Log Browser, site monitoring, process status, and job history. It does not currently document a supported external log drain or continuous Loki export.

Use the supported Frappe Cloud views:

- [Logs](https://docs.frappe.io/cloud/logs)
- [Log Browser](https://docs.frappe.io/cloud/devtools/log-browser)
- [Site monitoring](https://docs.frappe.io/cloud/sites/monitoring)

When Suite sites run on Frappe Cloud, this stack collects only logs from separately managed services such as the Meet SFU, recorder, and Nginx. Ask Frappe Cloud support before building against undocumented Press log endpoints or persistent SSH sessions.

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

Loki is not an availability dependency for Grafana or Suite. Alloy retries network, server, and rate-limit failures for several hours in memory. Authentication failures are not retried. Restarting Alloy during an outage can still lose unsent lines, so check Alloy logs and the time of the latest Loki line after every outage.

```bash
docker compose ps
docker compose logs -f prometheus loki grafana caddy
docker compose pull
docker compose up -d
```

Back up the `prometheus-data`, `loki-data`, `grafana-data`, `caddy-data`, and `caddy-config` Docker volumes. Stop the Alloy collectors, then stop Loki while copying `loki-data` so the filesystem backup is consistent. Test restore steps on another volume before relying on the backup.

To rotate the push credential:

1. Generate one new password and hash.
2. Stop both Alloy collectors.
3. Replace the hash in the monitoring VPS `.env` and recreate Caddy.
4. Replace the plain password file on each source host.
5. Start both Alloy collectors.
6. Confirm new logs arrive, then discard the old credential.

If the Loki disk fills, stop the Alloy collectors first. Free or extend disk space, start Loki, and then restart the collectors. Do not delete Loki files by hand.

Run `./validate-config.sh` after changing Loki, Caddy, Alloy, or Compose configuration. Do not expose Prometheus port 9090 or Loki port 3100 publicly.

Existing monitoring deployments without log ingestion can update directly. Caddy protects the push path with a discarded fallback credential while `LOKI_PUSH_ENABLED=false`. Enabling pushes requires the user and hash together.

To move an active collector from the former separate log hostname:

1. Stop the SFU and Frappe Alloy collectors.
2. Change each `LOKI_PUSH_URL` to `https://<GRAFANA_DOMAIN>/loki/api/v1/push`.
3. Deploy this Caddy configuration on the monitoring host.
4. Start the collectors and confirm new logs arrive.
5. Remove the old log DNS record after all collectors use the Grafana hostname.

## Error tracking

Use three Sentry projects so ownership, alerting, and releases remain independent:

- Frontend: set `SUITE_FRONTEND_SENTRY_DSN` in the Frappe web process environment.
- Backend: set `FRAPPE_SENTRY_DSN` in the Frappe web and worker process environments.
- SFU: set `SENTRY_DSN` in each SFU deployment.

Enable telemetry in System Settings to permit frontend and backend reporting. Frappe Framework provides backend coverage for Suite requests, background workers, Desk, and errors passed to `frappe.log_error()`. The unified Suite browser application reads its separate frontend DSN at runtime.

The SFU is deployed separately; see `../sfu-server/deploy/.env.example`. Set `SENTRY_RELEASE` to the deployed commit or image version to make regressions actionable. The Suite frontend release defaults to the installed Suite version, while Frappe supplies its own backend release metadata.

Sentry is reserved for unexpected exceptions and process failures. Prometheus remains the source for failure rates and service health, while operational and expected client/WebRTC failures remain in metrics and logs.
