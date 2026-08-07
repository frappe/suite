# Meet recorder server

## Dedicated production deployment

Use the standalone deployment when the Recorder Endpoint runs on a dedicated
host rather than beside the SFU. It deploys only the recorder and its HTTPS
control proxy; it does not deploy or modify an SFU.

Prerequisites:

- Docker with Compose v2
- A DNS A/AAAA record for the recorder host
- Public TCP ports 80 and 443
- At least 4 CPU cores, 6 GiB memory, and storage for in-progress artifacts

Install the deployment files:

```sh
curl -fsSL https://raw.githubusercontent.com/frappe/suite/develop/suite/meet/recorder-server/deploy/install.sh | sudo bash
cd /opt/meet-recorder
```

Generate independent secrets and configure `.env`:

```sh
openssl rand -base64 48
openssl rand -hex 32
```

Set `RECORDER_SECRET` to the first value and `RECORDER_METRICS_TOKEN` to the
second. Set the exact Frappe site, Frappe HTTPS origin, existing public SFU
origin, recorder hostname, and TLS email before starting:

```sh
./deploy.sh setup
./deploy.sh status
```

The recorder API remains bound to host loopback on port 3010. Caddy exposes
only `/v1/recordings`, `/health`, and `/ready` over HTTPS; metrics remain
loopback-only. Configure the Frappe site with the same secret:

```json
{
  "recorder_server_url": "https://recorder.example.com",
  "recorder_secret": "<same RECORDER_SECRET from .env>",
  "recorder_site_origin": "https://site.example.com"
}
```

Management commands:

```sh
./deploy.sh start
./deploy.sh stop
./deploy.sh update
./deploy.sh status
./deploy.sh logs recorder
```

Back up the `suite-recorder_recorder-data`, `suite-recorder_caddy-data`, and
`suite-recorder_caddy-config` volumes. Do not use `docker compose down -v`, and
do not stop or update the deployment during an active Recording Session.

## Chromium integration test

Build the recorder browser assets, then run the recorder-server tests:

```sh
yarn --cwd frontend build:recorder
CHROMIUM_EXECUTABLE=/usr/bin/chromium RECORDER_CHROMIUM_NO_SANDBOX=1 yarn --cwd suite/meet/recorder-server test
```

The executable and no-sandbox setting above match the recorder Docker image. Locally,
the test also detects conventional Chrome/Chromium installation paths and skips only
when no executable is available. This test intentionally uses an empty producer sync;
it verifies signaling and receive-transport construction, not media consumption or
artifact generation against a real mediasoup router.
