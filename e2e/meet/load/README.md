# Meet Measurement Harness

This is a bounded measurement client for the current SFU signaling contract. Every
artifact says `qualified: false`. A successful local run proves only that its own
synthetic Participant Connections joined, optionally exchanged media, and cleaned
up. It is not a capacity, production-browser, source-fidelity, bitrate, or recorder
result.

## Safety

- The default target is loopback port 3001. Port 3000 is always rejected because it
  is the shared development SFU. Non-loopback targets require
  `--allow-remote-target`, which represents explicit operator authorization.
- Runs require an idle `/health` and authenticated `/metrics` before sending traffic.
  The unique default Meet Room and `load.test` site namespace identify run-owned
  resources. Counts are bounded to 1-150, holds to 1-600 seconds, and ramps to 0-5000
  milliseconds. Cleanup polling defaults to 65 seconds and is bounded to 90.
- JWTs and metrics credentials come from named environment variables or a JSONL
  token file. They are not accepted on the command line, written to reports, or
  included in raw errors. Output and conventional token files are denied by Vite.
- Cleanup stops local tracks, closes only harness browsers/server, emits `leave_room`,
  then verifies SFU health, resource gauges, and local tracks returned to idle.

## Run

Use an isolated SFU configured with the same random secrets and a non-3000 port:

```bash
SFU_LOAD_JWT_SECRET=local-secret SFU_METRICS_TOKEN=local-metrics \
  yarn --cwd e2e load:meet --sfu-url http://127.0.0.1:4317 \
  --count 2 --media none --duration-seconds 2 \
  --output /tmp/meet-load-local.json
```

`--scenario representative-camera` publishes deterministic first `--cameras`
(default `min(40, count)`, maximum 40) Participant Connections and leaves the rest
idle. Each camera is a moving, time-coded 1280x720 canvas captured at a requested 30
fps; it does not use Chromium's generic fake camera. Reports keep requested source
properties separate from observed track settings, sender `outbound-rtp` bytes,
`framesEncoded` and fps, `media-source` dimensions/fps, and every eager receiver's
`inbound-rtp` bytes, decoded frames, dimensions, and fps. Missing browser stats are
`null`; short runs do not establish bitrate or sustained fps. Producer IDs, enabled
and unpaused state, RTP/frame progression, decoded delivery when exposed, and SFU
Producer/Consumer counts are checked across the hold window. One muted 1x1 off-screen
video probe per Participant Connection drives playback and exposes Chromium's browser
decoded-frame count; this avoids O(N) rendered elements. Full rendering remains off
unless explicitly requested.

`--media audio|video|both` uses Chromium's synthetic fake devices. Reports retain
actual capture settings and observed RTP byte counters, but synthetic devices do not
model representative speech/cameras and requested settings do not prove delivered
resolution, frame rate, or bitrate. `--consume none` isolates publication.

`--scenario rotating-audio --media audio` gives every participant one persistent,
enabled, unpaused microphone Producer sourced from a 440 Hz Web Audio oscillator.
Only a `GainNode` changes: `--talkers` (default 10, never above `--count`) rotate on
the configured `--rotation-interval-ms` cadence. Reports include each expected
active set, actual gain-state boundaries and duration, per-publisher outbound RTP and
optional audio-energy deltas, per-receiver inbound continuity, Producer IDs, and SFU
Producer/Consumer gauges for every window.
Configured gain is not proof of acoustic delivery; `totalAudioEnergy` is recorded
when Chromium exposes it, otherwise the report says `null`.

Server measurements need a dedicated authorized SFU, valid full-scope participant
tokens matching the generated room/site (or its signing secret), and authenticated
Prometheus metrics. A token file contains exactly `--count` JSONL rows shaped as
`{"userId":"...","name":"...","token":"..."}`. Reports record endpoint,
loopback classification, resolved workload, browser/host identity, generator process
resource deltas, before/hold/after SFU resource gauges, participant observations, and
cleanup outcome.

## Progressive Scenarios

Admission plus idle hold, uniform synthetic media, rotating audio, and representative
camera measurement are implemented. The remaining representative suite is two 1080p30 screens
capped at 4 Mbps, and one Recorder Endpoint. Pinned representative video, actual
delivered video constraints, screen publication, and recorder support must be
implemented and measured before those properties are claimed.

## Verification

```bash
yarn --cwd e2e test:meet-load
yarn --cwd e2e typecheck
yarn knip:e2e
yarn check:meet-types
yarn test:meet-type-policy
git diff --check
```
