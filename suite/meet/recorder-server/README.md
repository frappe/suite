# Meet recorder server

## Dedicated production deployment

The Recorder Endpoint uses a standalone production deployment. It deploys only
the recorder and its HTTPS control proxy; it does not deploy or modify an SFU.

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
origin, recorder hostname, TLS email, and `RECORDER_MIN_FREE_BYTES` floor before
starting. New sessions reserve twice their byte budget for retained segments and
finalization output; `/ready` fails when free space falls below the floor.

```sh
./deploy.sh setup
./deploy.sh status
```

The recorder API remains bound to host loopback on port 3010. Caddy exposes
the control and status routes plus bearer-protected `/recorder/metrics` over
HTTPS. Frappe probes `/v1/deployment-health` with a short-lived deployment-health
JWT; the response is advisory, while `POST /v1/recordings` remains the only
authoritative admission decision. Configure the Frappe site with the same secret:

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

The recorder runs as the image's unprivileged `node` user with all Linux
capabilities dropped and a read-only root filesystem. Only `/data`, `/tmp`, and
the ephemeral node home are writable. Restrict recorder-host egress separately
to the configured Frappe and SFU origins plus the WebRTC media destinations
required by that SFU deployment.

## Segment progress failures

Cumulative segment progress retries transport failures, HTTP 408/429, and HTTP
5xx up to three attempts, each capped at ten seconds (or the shorter configured
callback timeout), with 250 ms and 500 ms backoff. Each attempt uses a fresh JWT
and the same captured byte count, so a lost response after a committed update is
safe to retry. Backend refusals and invalid response contracts are not retried.

Structured `segment_progress_callback_failed` logs identify the job, attempt,
transport code or HTTP status, and whether a retry will follow. They never include
authorization headers or response bodies. Exhaustion or a permanent refusal still
stops capture; `capture_budget_check_failed` also records local budget-check
failures before stopping. The existing callback protocol and terminal reason
mapping are unchanged.

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
