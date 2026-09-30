# One-Router Meet Correctness Baseline

Real Chromium WebRTC against the current SFU, with eager fixed video selection.
Every report declares `summary.scope: "correctness-only"` and `qualified: false`,
including successful runs. This does not qualify 150 participants or production
capacity. External host/Linux collectors, practical-throughput measurements and
generator saturation gates are deferred, not silently treated as passing.

## Safety and Evidence

- Use only a dedicated, explicitly authorized target. Local probes start their own
  authenticated loopback SFU; the test suite never targets a deployed SFU.
- `/health` and global/worker resource gauges must prove idle both before browser
  preparation and immediately before joins. Unexpected extra rooms, participants,
  peers or sockets abort queued work.
- Room IDs must be unique `load-<UUIDv4>` values; sites must use `load.test`,
  `load.*.test` or `load-*.test`. Defaults generate a new room.
- Bounds: 1-24 participants and concurrent joins, 0-5000 ms ramp, 1-600 seconds
  hold, 65-120 seconds cleanup, 1-60 seconds per join and 1,000 evidence samples.
  Start with 2-4 clients. These bounds are not production-load authorization.
- Credentials come from environment variables or JSONL, never CLI token values.
  Token claims must match namespace, identity, full scope and run lifetime.
  The SFU verifies signatures; local claim checks are only a safety preflight.
- Reports redact known secrets (including escaped forms), JWTs, credential-valued
  fields and URL userinfo. Errors retain bounded classifications, not raw server
  diagnostics. Vite excludes credential/output files and unrelated repository files.
- SIGINT/SIGTERM cancel queued work and enter cleanup. Normal failure paths attempt
  leave, close browsers/Vite and persist an artifact. SIGKILL, host failure or an
  unwritable filesystem cannot guarantee an artifact or acknowledged cleanup.

Authenticated SFU Prometheus scrapes remain mandatory throughout the run: worker
CPU counters and maximum RSS, worker/global resources, process RSS, event-loop
delay, and active-media operation/score histograms. CPU deltas are normalized to
one core, not host core count. Unsupported required metrics invalidate the run;
missing values never become fabricated zeroes. Evidence cadence over 2.5 seconds
invalidates the run. No external host evidence is required for this correctness scope.

## Protocol and Media

The client imports the current shared `PARTICIPANT_MEDIA_PROTOCOL_VERSION`, sends
it in Socket.IO auth and `join_room`, and validates advertised capability and queue
fields before media allocation. There is no version autodetection, reconnect,
retry or legacy fallback. Requested version, safe capabilities and at most 64
rejections are retained. Terminal codes are allowlisted:
`MEDIA_PROTOCOL_VERSION_MISMATCH`, `ROOM_FULL`, `MEDIA_CAPACITY_UNAVAILABLE`,
`VIDEO_CONSUMER_LIMIT`, `PARTICIPANT_CONNECTION_CONFLICT`; others become
`UNKNOWN_REJECTION`. UI action/retry policy is not part of this harness.

Each remote video is added to serialized cumulative `video:set_selection` intents
before consumer creation, then resumed through visible preferences after attachment.
All sources are required; there is no optional hidden-video mode. Exceeding the
server's selection ceiling fails instead of silently omitting cameras.
`--render-media` attaches elements but does not run the production Vue layout.

This compact slice adds talkers, screens, and a bounded one-video churn control
(`window.meetLoad.setSelection`, server-owned five-second warm retention,
stale revisions rejected). The client has no warm expiry or eviction timers;
it reconciles acknowledged retained IDs and handles `consumer_closed`.
`selection-churn.test.mjs` rotates one
viewer between two cameras on a loopback SFU: selected video arrives decoded,
deselected RTP stalls warm then expires, audio continues, counts stay bounded,
and cleanup succeeds. SFU consumer gauges and local consumer state are checked
independently: a missing server closure notification fails, rather than being
masked by a client close. Camera publication churn, selection timing SLOs and
active-speaker-detection SLOs are deferred; none is claimed.

- `--active-talkers 0..audio-publishers` defaults to all. A rotating contiguous
  window advances one audio publisher every `--talker-period-seconds` (default 5,
  range 1-600), anchored to the shared pre-join epoch. Gain zero silences the
  WebAudio source, never pauses the Producer or disables its track. All audio
  sources still require RTP. Default all preserves the original capture path.
- `--screen-publishers 0..2` defaults to zero, at most one on each of the first two
  humans; it does not add participants. Browser fixture
  `canvas-moving-bars-1080p30-v1` captures 1920x1080 at requested 30 fps with a
  single encoding capped at 4 Mbps. Deterministic frame content is not a
  representative desktop workload; browser scheduling is not deterministic and
  neither actual 30 fps delivery nor 4 Mbps throughput is guaranteed.
- Reports retain screen fixture identity, source `isScreen`, negotiated RTP,
  observed bitrate, audio gain, Producer paused/track-enabled state and bounded
  talker step/gain timestamps. Native ended tracks and closed AudioContext are
  checked on cleanup. These are synthetic controls, not production UI behavior.

The CLI verifies each audio Producer throughout HOLD: unpaused, enabled, declared
gain and current-phase gain event (events unnecessary for default all-active).
Gain observations within +/-100 ms of rotation boundaries are excluded; missing
stable coverage beyond 2.5 seconds or fewer than two verified observations is
invalid. Nonzero partial talker windows must show distinct subsets. Short or
boundary-aliased runs may be invalid. Neither historical RTP nor gain proves speech.

Generate deterministic fixtures without downloads or FFmpeg:

```bash
node e2e/meet/load/fixtures.mjs e2e/meet/load/fixtures
```

`fixtures.json` contains SHA256 pins for one-second looping 1280x720/30 I420 moving
texture and 48-kHz mono PCM audio. Each publishing kind requires its path and hash,
verified before target access. The media is repeatable, not validated representative
speech/camera content. Capture must report 720p30.

Production encoding imports supply Opus options and default VP9 `L3T1_KEY` SVC;
`--video-codec VP8` selects production three-encoding simulcast. Supported SVC modes
can be pinned with `--scalability-mode`; no silent codec fallback exists.
Pin `--browser-version` to exact `browser.version()`. `CHROME_CHANNEL` selects an
installed channel without fallback. The manifest records browser flags/versions,
Node/kernel/CPU identity, Git revision/dirty state, source/lockfile hashes, resolved
arguments, fixture pins and media policy. Non-Git builds require `--build-id`.

## Small Mixed Run

Set `SFU_LOAD_JWT_SECRET` for controlled staging signing and `SFU_METRICS_TOKEN`
for authenticated metrics, then use the generated fixture hashes:

```bash
yarn --cwd e2e load:meet \
  --sfu-url http://127.0.0.1:3000 --count 4 \
  --audio-publishers 2 --camera-publishers 2 --overlap-publishers 1 \
  --join-concurrency 4 --ramp-ms 0 --duration-seconds 30 \
  --browser-version EXACT_INSTALLED_VERSION \
  --video-fixture meet/load/fixtures/camera-720p30-v1.y4m --video-sha256 VIDEO_HASH \
  --audio-fixture meet/load/fixtures/microphone-v1.wav --audio-sha256 AUDIO_HASH
```

Paths resolve from the working directory. Alternatively use `--meeting-id
load-UUIDv4 --token-file /secure/participants.jsonl` with exactly one unique
`{"userId":"...","name":"...","token":"..."}` entry per client.

Population order is mixed, remaining microphones, remaining cameras, receive-only.
The example publishes four sources, with remote counts `[2, 3, 3, 4]` (12 total).
Overlap defaults to `min(audio,camera)`. `--media audio|video|both|none` is a uniform
shorthand mutually exclusive with publisher counts; `--consume none` isolates ingress.
Pages prepare before scheduling. Ramp is an absolute inter-start target, not a
post-join delay. The bounded queue records schedule/dispatch/browser/join/RTP times
and backlog; failed work cancels future ramp waits while draining in-flight starts.

## Report Gates

Results default to `e2e/meet/load/results/` or `--output`. Exit code 1 means `failed`
or `invalid`; inspect `summary.status` before attributing failure to the SFU.
Raw before/after metrics and bounded per-second SFU/browser time series are embedded.

Delivery compares actual Producer IDs at every destination against all declared
remote publications. Every source requires negotiated RTP, bytes, packets and a
first-RTP observation; received video also requires decoded frames. Active transports
must remain connected. Stats count each negotiated primary SSRC once, excluding RTX
and other tracks even in transport-wide reports. Aggregate traffic cannot hide a
missing source. Receivers require loss/jitter/RTT/bitrate; video also requires
NACK/PLI/FIR. Raw reports retain observed codecs and other available metrics.
SFU scores are aggregate histograms, not per-consumer traces.

Default limits are join P95 2 seconds, first remote RTP P95 3 seconds and aggregate
loss 3%. Recorded overrides are `--max-join-p95-ms`,
`--max-first-remote-media-p95-ms`, `--max-packet-loss-ratio`. First media is sampled
every 500 ms from browser setup, not packet-capture timing or join acknowledgment.

Leave acknowledgment proves peer cleanup, not room expiry. Sampling continues
through browser closure and at least 65 seconds cleanup for the 60-second room
grace. Final room/participant/peer/transport/producer/consumer/socket and worker
resource gauges must be zero. Unknown admission or missing leave acknowledgment
is invalid; explicit leave rejection fails even if disconnect later clears it.
Unstarted or explicitly rejected joins need no leave acknowledgment. Internal
registry/timer indexes are not independently exported or verified.

## Verification

```bash
yarn --cwd e2e test:meet-load
yarn --cwd e2e typecheck

# Server-owned warm expiry and local closure notification
CHROME_CHANNEL=chrome MEET_LOAD_LOCAL_SFU=1 \
  node --test e2e/meet/load/selection-churn.test.mjs

# Installed Chrome, sequential local browser and four-client native SFU probes
CHROME_CHANNEL=chrome MEET_LOAD_BROWSER_SMOKE=1 MEET_LOAD_LOCAL_SFU=1 \
  node --test --test-concurrency=1 e2e/meet/load/*.test.mjs

# Positive CLI artifact, four mixed clients and full 65-second cleanup
CHROME_CHANNEL=chrome MEET_LOAD_LOCAL_SFU=1 MEET_LOAD_LOCAL_CLI=1 \
  node --test e2e/meet/load/sfu.test.mjs

# Same four humans, two screens and one of two talkers rotating every two seconds
CHROME_CHANNEL=chrome MEET_LOAD_LOCAL_SFU=1 MEET_LOAD_LOCAL_CLI=1 \
  MEET_LOAD_MEASUREMENT=1 node --test e2e/meet/load/sfu.test.mjs
```

Omit `CHROME_CHANNEL` for installed Playwright Chromium. Browser loopback verifies
capture, decoded VP9 and decoded Opus audio energy. Native SFU tests start current
source with installed ts-node/native mediasoup, one worker, random credentials and
loopback HTTP/UDP, without `.env`, deployment URLs, downloads or auth/rate-limit
bypasses. The short probe checks identified growing RTP and acknowledged peer cleanup
within 30 seconds; the CLI variant checks the successful sanitized artifact and
post-grace zero resources within 120 seconds. Temporary artifacts are removed after
assertions. Neither probe qualifies capacity, production UI queues, recorder or E2EE.

Optional generator image (repository root):

```bash
docker build -f e2e/meet/load/Dockerfile -t meet-load .
```

Mount fixtures, credentials and writable results; supply immutable `--build-id`
and exact image Chromium version. Local tests do not build or pull Docker images.
