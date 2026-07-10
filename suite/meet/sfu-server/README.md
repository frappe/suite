# Frappe Meet SFU Server

Mediasoup-based Selective Forwarding Unit (SFU) for Frappe Meet.


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
