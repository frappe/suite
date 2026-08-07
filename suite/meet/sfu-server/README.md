# Frappe Meet SFU Server

Mediasoup-based Selective Forwarding Unit (SFU) for Frappe Meet.

## Development Setup

From the Suite app directory, install the SFU dependencies and create a local environment file:

```bash
cd suite/meet/sfu-server
yarn install
cp .env.example .env
```

Set `JWT_SECRET` in `.env` to a development secret. The default host, signaling port, and WebRTC settings in `.env.example` are suitable for local development.

From your bench directory, configure the Frappe site with the local SFU URL and the same secret:

```bash
bench --site suite.localhost set-config sfu_server_url http://localhost:3000
bench --site suite.localhost set-config sfu_secret your_jwt_secret_here
```

Replace `suite.localhost` with your site name, then return to `apps/suite/suite/meet/sfu-server` and start the SFU:

```bash
yarn dev
```

The signaling server runs at `http://localhost:3000`. Check `http://localhost:3000/health` to verify that it is ready, then run the Frappe development server with `bench start` in a separate terminal.

## Production Deployment

### Prerequisites

- A server with Docker and Docker Compose v2 installed
- A domain pointing to the server (e.g., `sfu.example.com`)
- Ports open: `80/tcp`, `443/tcp`, and the SFU media UDP ports. By default this starts at `40000/udp` and uses one port per mediasoup worker.

### Quick Start

```bash
# Install on the server (downloads deploy files to /opt/meet-sfu)
curl -fsSL https://raw.githubusercontent.com/frappe/suite/develop/suite/meet/sfu-server/deploy/install.sh | bash

# Configure
cd /opt/meet-sfu
nano .env
```

Set the required values in `.env`:

| Variable | Description | Example |
|---|---|---|
| `JWT_SECRET` | Shared secret with Frappe (generate: `openssl rand -base64 32`) | `a1B2c3D4...` |
| `WEBRTC_LISTEN_IP` | Local interface IP for SFU media sockets; leave blank to auto-detect | `10.0.1.12` |
| `WEBRTC_ANNOUNCED_IP` | Server's public IP (find: `curl -4 ifconfig.me`) | `203.0.113.10` |
| `WEBRTC_SERVER_PORT` | First UDP port for WebRTC media | `40000` |
| `MEDIASOUP_NUM_WORKERS` | Number of mediasoup workers; media uses one UDP port per worker | `4` |
| `DOMAIN` | Domain pointing to this server | `sfu.example.com` |
| `SSL_EMAIL` | Email for Let's Encrypt notifications | `admin@example.com` |
| `METRICS_TOKEN` | Optional bearer token enabling the Prometheus `/metrics` endpoint | `openssl rand -hex 32` |
| `SENTRY_DSN` | Optional Sentry DSN for unexpected SFU failures | Sentry project DSN |
| `RECORDER_SECRET` | Dedicated Frappe-to-recorder control secret; do not reuse `JWT_SECRET` | `openssl rand -base64 32` |
| `RECORDER_METRICS_TOKEN` | Dedicated recorder metrics bearer token | `openssl rand -hex 32` |
| `RECORDER_SITE` | Frappe site authorized to issue recorder commands | `site.example.com` |
| `RECORDER_SITE_ORIGIN` | Exact HTTPS origin for that site | `https://site.example.com` |

Then run setup:

```bash
./deploy.sh setup
```

This pulls the SFU and recorder images, provisions an SSL certificate, and starts
the stack. Recording grant consumption and recorder jobs/artifacts are stored in
the persistent `sfu-grants` and `recorder-data` volumes. Back up both volumes and
size `recorder-data` for in-progress segments plus artifacts awaiting upload.

### Frappe Configuration

Add to your Frappe site's `site_config.json`:

```json
{
  "sfu_server_url": "https://sfu.example.com",
  "sfu_secret": "<same JWT_SECRET from .env>",
  "recorder_server_url": "http://127.0.0.1:3010",
  "recorder_secret": "<same RECORDER_SECRET from .env>"
}
```

The recorder does not mint or recover Recording Grants. Frappe remains required
to issue every proof-bound grant; after a recorder restart, active jobs fail
closed until the control plane explicitly coordinates recovery with a fresh
grant. Only already-stopping local captures are finalized from persistent data.

### Management Commands

```bash
./deploy.sh start      # Start all services
./deploy.sh stop       # Stop all services
./deploy.sh restart    # Restart all services
./deploy.sh update     # Pull latest images and recreate SFU and recorder
./deploy.sh logs       # Tail logs (use: ./deploy.sh logs sfu)
./deploy.sh status     # Show health and container status
./deploy.sh ssl-renew  # Force SSL certificate renewal
```

### Updating

When new changes are pushed to `develop`, GitHub Actions builds and pushes the SFU and recorder images. To update both services on your server:

```bash
cd /opt/meet-sfu
./deploy.sh update
```

### Firewall Rules

| Port | Protocol | Purpose |
|---|---|---|
| 80 | TCP | HTTP / ACME challenges |
| 443 | TCP | HTTPS |
| 40000 to 40000 + workers - 1 | UDP | WebRTC media, one fixed UDP port per mediasoup worker |

### Observability

Set `METRICS_TOKEN` to enable Prometheus metrics. The endpoint returns `404` when the variable is unset and requires a bearer token when enabled:

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://sfu.example.com/metrics
```

Metrics include process health, authenticated socket connections, bounded disconnect reasons, room join/rejoin outcomes and latency, WebRTC transport operations, current SFU resource counts, and sampled browser outcomes for first remote media, receive stalls, and recovery success. Browser sampling is fixed at 5%. Lifecycle logs are emitted as JSON without meeting, participant, socket, or transport identifiers.

Set `SENTRY_DSN` to report unexpected process failures and mediasoup worker deaths. `SENTRY_ENVIRONMENT` defaults to `production`; set `SENTRY_RELEASE` to the deployed image or commit version. Expected authentication, client-state, and WebRTC operation failures remain in metrics and logs rather than being reported as Sentry issues.
