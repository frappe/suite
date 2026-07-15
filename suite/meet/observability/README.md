# Frappe Meet Observability

Central Prometheus and Grafana deployment for one or more SFU servers. Prometheus is available only inside the Docker network; Caddy exposes Grafana over automatic HTTPS.

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
chmod 600 secrets/sfu_metrics_token
```

Set the same token as `METRICS_TOKEN` on every SFU. Edit `.env` with the Grafana domain and a strong admin password. Generate a password with:

```bash
openssl rand -base64 32
```

List every SFU hostname in `prometheus/targets/sfu.yml`:

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

Open `https://<GRAFANA_DOMAIN>`, sign in, and use the provisioned Prometheus datasource. Check scrape health at **Connections > Data sources > Prometheus > Explore** with:

```promql
up{job="frappe-meet-sfu"}
```

Each SFU appears under Prometheus's automatic `instance` label.

## Local test

Set these values in `.env`:

```env
GRAFANA_DOMAIN=localhost
GRAFANA_ROOT_URL=http://localhost:3000
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=local-test-password
PROMETHEUS_RETENTION=7d
```

Put the same local test token in `secrets/sfu_metrics_token` and configure `prometheus/targets/sfu.yml` to scrape the host machine from Docker:

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

In another terminal, start only Prometheus and Grafana. Caddy is not needed locally:

```bash
cd ../observability
docker compose up -d prometheus grafana
```

Open Prometheus at `http://localhost:9090/targets` and Grafana at `http://localhost:3000`. The `frappe-meet-sfu` target should be `UP`. Test the datasource in Grafana Explore with:

```promql
up{job="frappe-meet-sfu"}
```

Stop the local stack with:

```bash
docker compose down
```

## Operations

```bash
docker compose ps
docker compose logs -f prometheus grafana caddy
docker compose pull
docker compose up -d
```

Back up the `prometheus-data`, `grafana-data`, `caddy-data`, and `caddy-config` Docker volumes. Do not expose Prometheus port 9090 publicly.
