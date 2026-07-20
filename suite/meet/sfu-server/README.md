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

Then run setup:

```bash
./deploy.sh setup
```

This will pull the SFU image, provision an SSL certificate, and start everything.

### Frappe Configuration

Add to your Frappe site's `site_config.json`:

```json
{
  "sfu_server_url": "https://sfu.example.com",
  "sfu_secret": "<same JWT_SECRET from .env>"
}
```

### Management Commands

```bash
./deploy.sh start      # Start all services
./deploy.sh stop       # Stop all services
./deploy.sh restart    # Restart all services
./deploy.sh update     # Pull latest image and restart SFU
./deploy.sh logs       # Tail logs (use: ./deploy.sh logs sfu)
./deploy.sh status     # Show health and container status
./deploy.sh ssl-renew  # Force SSL certificate renewal
```

### Updating

When new changes are pushed to `develop`, the GitHub Actions workflow builds and pushes a new Docker image. To update the SFU on your server:

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
