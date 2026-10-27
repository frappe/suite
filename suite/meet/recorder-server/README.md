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

Unexpected ffmpeg termination emits `capture_process_exited` with its numeric
exit code and terminating signal (either may be null), before startup failure or
recovery handling. Retain these structured service logs independently of the
capture spool: successful delivery can remove the per-capture ffmpeg logs. The
event excludes command arguments, stderr, credentials, and meeting content.

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

The native `dist/integration/CaptureWorker.integration.js clean|recovery` check
also supports `FFMPEG_EXECUTABLE`, `XVFB_EXECUTABLE`,
`PULSEAUDIO_EXECUTABLE`, and `PACTL_EXECUTABLE` overrides. Put the matching
`ffprobe` on `PATH`, set `CHROMIUM_EXECUTABLE` and a private `OUTPUT_ROOT`, and
retain failed manifests and media-tool logs when investigating a partial result.

## Durable transcription sources

Transcription-only capture does not reserve or launch a Chromium endpoint. The SFU
uses a separate decoded microphone consumer and CPU Silero detector for each
participant producer. Speech spans retain two seconds of real pre-roll and 500 ms
of tail, flush after DTX inactivity, and have a 15-second upper bound. Long
continuous speech can still cross that bound; the accepted real-Meet segmentation
quality gate applies before deployment. Live-caption subscribers and model
availability do not control this path.

Sources are PCM16LE, mono, 24 kHz, under
`RECORDER_DATA_ROOT/.transcription-sources/<site-sha256>/<capture>/`. This namespace
is separate from video job directories and is on the existing persistent recorder
volume. Each visible segment and its manifest are synced before acknowledgement.
Process startup marks unfinished captures partial; it never resumes them. A source
contains its speaker identity and integer capture-relative start/end milliseconds,
byte count, sample rate and SHA-256. These are source sample-clock spans anchored
to capture's monotonic clock, not ASR response timestamps. DTX pauses start new
spans rather than compressing the capture timeline. The backend retains the
relationship to independently timed video capture epochs and gaps.

The API base is `/v1/transcriptions/:capture`, where `capture` is the common Meet
Recording identifier, including when video is disabled. It accepts HS256 bearer
JWTs signed with `RECORDER_SECRET`, header `typ=meet-transcription-source+jwt`,
audience `meet-transcription-source`, issuer equal to `RECORDER_SITE_ORIGIN`, and
claims `site`, `origin`, `room`, `capture`, `operation`, `iat`, `exp`. Site/origin
must match this recorder's configured site. Control/read tokens last at most 120
seconds. Capture capabilities last at most four hours plus 60 seconds; only the
backend and SFU receive them.

| Method and suffix | Operation | Contract |
| --- | --- | --- |
| POST base | `reserve` | JSON `{max_bytes,max_duration_ms}`; both limits must also be signed claims |
| GET `/capture-state` | `capture` | Minimal liveness/closure state; SFU detects a recorder restart even when all microphones are silent |
| POST `/begin` | `capture` | JSON `{started_at}` pins the actual audio epoch before PCM decoding, independently of reservation/video startup |
| PUT `/segments/:source_id` | `capture` | Raw `application/octet-stream`; headers `x-speaker-id`, `x-speaker-name` (URI encoded), `x-start-ms`, `x-end-ms`, `x-sha256` |
| POST `/complete` | `capture` | JSON `{gaps:[{start_ms,end_ms,reason}]}`; idempotently seals sources |
| GET `/manifest` | `manifest` | Durable state, timings, gaps, segments and summed `audio_seconds` |
| GET `/segments/:source_id` | `source` | Returns exact source bytes; token must additionally bind `source_id` |
| DELETE base | `delete` | Idempotent removal after successful processing, retention expiry or authorized deletion |

A manifest has `capture`, `site`, `room`, `started_at`, optional `ended_at`, `state`
(`capturing`, `complete`, `partial`, `failed`), admission limits, `gaps`, `audio_seconds`, and
`segments` with `source_id`, `speaker_id`, `speaker_name`, `start_ms`, `end_ms`,
`size`, `sha256`, `sample_rate`. Source IDs are opaque and safe path components;
arbitrary file paths are never accepted. Identical segment retries do not duplicate
audio. Conflicting retries and writes after sealing are rejected.

`RECORDER_TRANSCRIPTION_MAX_CONCURRENT` (default 16) and
`RECORDER_TRANSCRIPTION_STORAGE_BYTES` (default 10 GiB) bound audio admission
independently of recording capacity. Pending captures reserve their maximum bytes;
sealed sources count their actual retained bytes. Source admission also reserves
available disk space above `RECORDER_MIN_FREE_BYTES`. Backend policies apply the
per-site limits and failed-source seven-day retention; successful transcription
must explicitly authorize DELETE. Publishing video does not authorize source
cleanup. Audio, source manifests, jobs and results must never use ephemeral model
cache storage.

The SFU checks capture liveness every five seconds and stops on recorder closure or unavailability. The backend polls sealed manifests and queues batch work. If the SFU is lost while
the recorder survives, it detects the missing SFU capture and seals the retained
manifest with a known missing interval; the recorder alone cannot distinguish a
silent microphone from a dead SFU. Source URLs and capabilities are internal and
must not be returned as user-playable artifacts or logged.

The reverse proxy exposes transcription control separately from recording control:
PCM PUTs permit at most 2 MB at the proxy and 30 seconds of PCM at the service;
transcription JSON permits at most 512 KB. The SFU proxy permits 32 KB control
requests. Neither proxy logs bearer/source capabilities. Per-capture segment count
is capped at 10,000; reaching a bound stops capture with retained partial speech
rather than admitting unbounded source metadata.

A recorder-local sweep runs every minute and deletes sealed source audio seven
days after capture end even if the owning site is offline. Source retrieval also
checks that deadline directly. Orphaned active captures seal at their four-hour
limit. Missing/corrupt manifests fail only that capture; their raw files remain
counted against source admission and removable by authenticated DELETE, with a
hard four-hours-plus-seven-days expiry for uncommitted orphan data. A source-root
initialization fault returns transcription-only 503 responses and does not prevent
the existing video recorder from starting.
