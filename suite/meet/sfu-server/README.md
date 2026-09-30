# Frappe Meet SFU Server

Mediasoup-based Selective Forwarding Unit (SFU) for Frappe Meet.

## Speech-to-Text (Captions)

Real-time captions are powered by an on-premise NVIDIA Nemotron ASR backend.

### Local Development

Set `STT_SERVER_URL` to a running STT service that implements `/health` and the OpenAI Realtime transcription endpoint at `/v1/realtime`.

### Docker Compose

Set `STT_SERVER_URL` to an externally managed STT backend. The SFU deployment does not start an STT sidecar.

### SFU Environment Variables

The SFU deployment forwards these settings to the SFU only. Set the model ID
and language on the separately deployed STT server too; its attention context,
final-silence padding, and Hugging Face token belong only there.

| Variable | Description | Default |
|---|---|---|
| `STT_SERVER_URL` | SFU URL for the STT service | — |
| `STT_API_KEY` | Bearer token sent to the STT service when it requires authentication | — |
| `NEMOTRON_MODEL` | STT model ID sent in the Realtime session | `nvidia/nemotron-3.5-asr-streaming-0.6b` |
| `NEMOTRON_LANGUAGE` | Locale prompt such as `en-US`, or `auto` for multilingual rooms | `en-US` |
| `STT_SILENCE_MS` | Silence duration before finalizing an utterance | `500` |
| `STT_MIN_SPEECH_MS` | Minimum speech duration before normal silence final | `600` |
| `STT_MIN_TAIL_MS` | Minimum speech duration for short utterance final | `200` |
| `STT_SHORT_UTTERANCE_SILENCE_MS` | Silence duration before finalizing short utterances | `700` |
| `STT_PRE_ROLL_MS` | Real audio retained before speech detection; explicit override (0–14900 ms) | `2000` |

The SFU finalizes continuous speech every 15 seconds. If a Realtime stream exceeds
that utterance limit, queues more than 1 MiB of outbound WebSocket data, or leaves
eight committed utterances unacknowledged, the SFU closes that stream and
recreates its ingester while captions remain subscribed.

When `METRICS_TOKEN` is configured, `/metrics` exports aggregate
`meet_sfu_stt_audio_sent_seconds_total` and `meet_sfu_resources` counts for
captioned rooms, subscribers, producer ingesters, and Realtime streams. These
metrics have no room or participant labels and help compare browser-visible
caption delay with SFU audio delivery and isolated STT load measurements.

Caption segmentation uses the packaged Silero speech detector on the SFU CPU.
Each producer has its own recurrent state and ordered inference; the immutable
ONNX session is shared with one inference thread. A causal anti-alias FIR
resamples a separate copy from 24 kHz to 16 kHz for 32 ms detector windows.
Speech begins at probability 0.5 and continues at 0.35. A 100 ms ingest block
is voiced if any detector window in it is voiced. Silero retains up to two
seconds (96 KB) of real pre-roll to protect soft onsets while its speech
confidence builds. An explicit `STT_PRE_ROLL_MS` overrides this default.
Silence intervals remain, and the original mono 24 kHz PCM sent to Nemotron
is unchanged: no recognition-audio gain or model changes are involved.

The MIT-licensed ONNX model and license are included under `assets/silero-vad/`.
`SOURCE.json` pins official revision
`1e261b036686cd0017d500ee96acd1c4ba572a9d` and SHA-256
`1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`;
startup verifies that digest before loading. Docker explicitly copies these
assets. CPU-only `onnxruntime-node` is pinned to 1.30.0; installation sets
`ONNXRUNTIME_NODE_INSTALL=skip` to avoid additional GPU-provider downloads.
Model/runtime failures surface through ingester startup or recovery instead of
silently falling back to amplitude gating. Silero is the sole production speech
detector.

When Opus DTX stops decoded PCM during silence, the ingester also checks
elapsed inactivity using a monotonic clock. It finalizes after the configured
normal or short-utterance silence interval, even if no new PCM frames arrive.
An idle pending utterance needs at least `STT_MIN_TAIL_MS` (default 200 ms)
of actually sent audio, including real pre-roll and tails, to commit. A smaller fragment closes and recovers the stream
to discard its server-side buffer; a lone 100 ms block is not committed. Quiet-only
idle gaps clear pre-roll and detector context. Active audio resets the idle clock.
Complete real PCM samples remaining in a partial frame are sent before commit;
no synthetic audio is inserted.

### Private caption diagnostic slices

For an isolated caption benchmark, set `STT_DIAGNOSTICS_DIR` to an absolute
private artifact directory and `STT_DIAGNOSTICS_ROOM_ID` to one exact internal
SFU room ID, including its site namespace: `<site>::<meetingId>` (for example
`suite.localhost::bdac-oiuq-cvuk`). A bare meeting ID will not match.
Alternatively, `STT_DIAGNOSTICS_ROOM_IDS` accepts up to 20 comma-separated exact
IDs and takes precedence over the singular variable. Wildcards, empty entries,
and IDs longer than 140 characters disable capture. Capture is off by default;
caption subscribers cannot enable it.

Each ingester creates a random directory with mode `0700` and these `0600` files:

- `metadata.json`: room, participant, producer and stream IDs, creation time,
  PCM format and capture limits.
- `before-vad.pcm`: FFmpeg output before speech segmentation.
- `stt-sent.pcm`: audio queued on the STT websocket, not server acknowledgement.
- `events.jsonl`: monotonic `elapsedMs`, PCM byte offsets, queued commits,
  queued session configuration (`stt.session.update.sent` with model, language,
  sample rate and names), received transcription events, emitted Meet
  transcripts, safe RTP producer/consumer counters (`rtp.stats`, sampled every
  two seconds while capture is active), and `capture.end` with final offsets and termination reason.

Both PCM files contain mono signed little-endian 16-bit samples at 24 kHz.
`stt.commit.sent.audioOffset` identifies the end of each committed utterance in
`stt-sent.pcm`; received item IDs link commit acknowledgements and transcripts.
Correlate browser exports using the room and participant IDs in metadata.
Authentication headers and server error messages are excluded. Audio, names and
transcripts remain private benchmark data; do not put these artifacts in git.

A slice ends after 60 seconds, 2,880,000 bytes per PCM boundary, 1 MiB of events,
or 256 KiB of queued writes. A limit, I/O failure or normal shutdown closes the
slice without changing transcription. Wait for `capture.end` and closed files
before analysis; a limit or error means the slice may omit later audio/events.
A missing termination event means the capture is incomplete.
There are at most 10 capture attempts per process by default. Set
`STT_DIAGNOSTICS_MAX_SESSIONS=20` for a larger isolated run; the hard maximum is
20 and invalid values disable capture. Restart the test SFU for a fresh budget.
Capture shutdown does not wait for filesystem writes on the audio path.

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
| `WEBRTC_ANNOUNCED_IP` | Required in production; server's public IP (find: `curl -4 ifconfig.me`) | `203.0.113.10` |
| `WEBRTC_SERVER_PORT` | First UDP port for WebRTC media | `40000` |
| `MEDIASOUP_NUM_WORKERS` | Number of mediasoup workers; media uses one UDP port per worker | `4` |
| `SOCKET_PING_TIMEOUT` | Socket.IO timeout in milliseconds | `60000` |
| `SOCKET_PING_INTERVAL` | Socket.IO ping interval in milliseconds | `25000` |
| `DOMAIN` | Domain pointing to this server | `sfu.example.com` |
| `SSL_EMAIL` | Email for Let's Encrypt notifications | `admin@example.com` |
| `METRICS_TOKEN` | Optional bearer token enabling the Prometheus `/metrics` endpoint | `openssl rand -hex 32` |
| `SENTRY_DSN` | Optional Sentry DSN for unexpected SFU failures | Sentry project DSN |

The SFU validates all environment values before startup. Missing required values,
partial numbers such as `3000junk`, unknown log levels, and invalid port ranges
are reported together and stop the process.

Then run setup:

```bash
./deploy.sh setup
```

This pulls the SFU image, provisions an SSL certificate, and starts the stack.
Recording grant consumption is stored in the persistent `sfu-grants` volume.
Back up that volume. Recording requires the separate
[recorder deployment](../recorder-server/README.md).

### Frappe Configuration

Add to your Frappe site's `site_config.json`:

```json
{
  "sfu_server_url": "https://sfu.example.com",
  "sfu_secret": "<same JWT_SECRET from .env>"
}
```

Configure `recorder_server_url` and `recorder_secret` from the separate recorder
deployment. The recorder does not mint or recover Recording Grants. Frappe
remains required to issue every proof-bound grant.

### Management Commands

```bash
./deploy.sh start      # Start all services
./deploy.sh stop       # Stop all services
./deploy.sh restart    # Restart all services
./deploy.sh update     # Pull and recreate the SFU
./deploy.sh logs       # Tail logs (use: ./deploy.sh logs sfu)
./deploy.sh status     # Show health and container status
./deploy.sh ssl-renew  # Force SSL certificate renewal
```

### Updating

When new changes are pushed to `develop`, GitHub Actions builds and pushes the
SFU image. Update it with:

```bash
cd /opt/meet-sfu
./deploy.sh update
```

Before updating an older co-located deployment, let active Recording Sessions
finish, deploy the standalone recorder, and point Frappe at its HTTPS endpoint.
Then remove the old `suite-recorder` container. The existing `recorder-data`
volume is retained for backup or deliberate cleanup.

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
