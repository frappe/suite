# Meet network audit

This harness sends real Chromium WebRTC traffic through a local UDP relay. It
changes bandwidth, latency and packet loss without root or host network changes.
The receiver uses production Meet media code; signaling remains healthy.

## Run

Install root, frontend, e2e and SFU dependencies, plus Playwright Chromium. From the
repository root:

```bash
node e2e/meet/network/run.mjs
node --test e2e/meet/network/*.test.mjs
```

Set `MEET_NETWORK_OUTPUT` to retain separate runs. Ports 4317/4318 TCP and 44170 UDP
on 127.0.0.1/127.0.0.2 must be free. The runner owns and stops its SFU, Vite server,
browser and relay, generates temporary credentials, and checks zero media resources
at cleanup. Output includes `result.json`, screenshots, source/worker hashes,
per-second RTC samples, relay counters and `server.log`. Artifacts are ignored.

The packaged worker raises SIGILL on this host. Override it with a compatible build:

```bash
MEDIASOUP_WORKER_BIN=/path/to/mediasoup-worker node e2e/meet/network/run.mjs
```

See [the shared fixture](../camera-demand/README.md) for worker build instructions.

## Network profiles

| Profile | Down / up | Added RTT | Random loss | Duration |
| --- | --- | ---: | ---: | ---: |
| Baseline | Unlimited | 0 ms | 0% | 8 s |
| Slow | 512 / 256 kbps | 300 ms | 5% | 15 s |
| Severe | 128 / 64 kbps | 800 ms | 20% | 15 s |
| Restored | Unlimited | 0 ms | 0% | 30 s |
| Blackout | Unlimited | 0 ms | 100% | 10 s |
| Restored after blackout | Unlimited | 0 ms | 0% | 25 s |

Rates use decimal kilobits and include UDP payloads for RTP, RTCP, ICE and DTLS.
Directions have independent aggregate budgets and each adds half the RTT. The queue
is bounded at one second, separate from propagation delay. Overflow drops consume
no bandwidth reservation; profile changes flush queued packets. Queue loss adds to
seeded random loss. The first four ordered publisher send flows bypass impairment;
the receiver and its replacement ICE flows are impaired. Revisit that assumption if
the fixture gains transports. Browser/CDP throttling did not reliably impair RTP,
so blackout assertions verify actual packet drops and stopped delivery.

Baseline and restoration require progress on all six streams (four cameras, one
screen, oscillator audio) in the last three seconds. Blackout must stop RTP bytes.
The actual warning DOM must hide for healthy/restored states and show poor/critical
for impairment. Identity checks compare receiver streams to publisher Producer IDs.
Counters account for replaced Consumers; page errors or failed cleanup fail the run.
Slow/severe media quality is measured, without promising usability at those caps.

## Usable poor-link recording

Build the frontend first so `suite/public/frontend/assets/index-*.css` exists, then:

```bash
MEET_NETWORK_VIDEO=1 MEET_NETWORK_POOR_DEMO=1 node e2e/meet/network/run.mjs
```

This records `meet-full-call.webm` at 1440×900: 15 seconds healthy, 45 seconds at
1.5 Mbps down / 512 kbps up with 500 ms added RTT, no random loss and a 100 ms queue,
then 25 seconds restored. It uses production sender code, VP8 simulcast, participant
tiles and toolbar buttons with sample camera animation; screen sharing is omitted.
The fixture assembles the call shell; toolbar actions are presentation only.
Video mode without `MEET_NETWORK_POOR_DEMO` records the standard profiles instead.

The poor-link assessment requires five seconds of timestamped evidence, no audio
or video stall over two seconds, at least ten decoded frames on every camera,
under 10% audio concealment, observed downscaling, and a sustained poor warning.
Baseline/recovery require both audio and video progress. Chromium must confirm the
motion preference, encoding caps and audio/video priorities. Checked source patches
fail if their shared-fixture anchor is missing or ambiguous.

## Product policy and regression coverage

Only the existing tile warning icon/tooltip appears for poor or critical quality.
Local poor thresholds are ≥5% recent loss, ≥450 ms RTT, ≥40 ms jitter or a
three-second media stall. Slow source capture alone does not establish local-path
degradation. Critical thresholds are ≥18% loss, ≥1200 ms RTT, ≥150 ms jitter,
a six-second camera/audio stall, or an offline/failed connection. Missing/stale
measurements are unknown; missing samples preserve an outstanding warning.
Warnings clear after six healthy seconds. Static screens
and intentional pauses have separate handling. ICE control success alone cannot
report recovery: observed delivery/feedback must resume.

Upload uses fresh remote feedback; download uses recent per-stream counters and
decoding. RTX/FEC, probation SSRCs and inactive jitter do not contaminate quality.
SFU scores use authenticated participant IDs and current connection ownership,
refresh every five seconds, and expire from remote indicators after 15 seconds.

Camera senders request `motion`/`maintain-framerate`; screens request
`detail`/`maintain-resolution`. Audio sender priority is high, video low, where
supported; rejected priority hints fall back to video degradation preference alone.
Camera simulcast caps are 120/500/1800 kbps without a low frame-rate cap. The SFU
allocates independently per receiver, prioritizes speaking cameras, and restores
normal priority on silence, including in-flight worker updates. Lower spatial
layers retain the highest temporal layer unless explicitly capped. Mediasoup's
native congestion controller supplies cautious upgrades; the warning icon does not
control bandwidth. Tests cover asynchronous priority races, frozen/missing media,
concealed recovered audio and insufficient timing evidence.

## Limits and historical comparison

This is an isolated media integration test, not Frappe's authenticated Meeting page.
Default presentation tiles are stubs; video mode uses real tiles. Neither mode tests
poor publisher uplinks, speech intelligibility, joining on a weak link, signaling
outages, TURN/TCP fallback, mobile behavior or long calls. Audio is an oscillator;
Playwright's recording is silent. Full frontend typechecking has existing repository
errors; focused tests, SFU build/lint and live media checks are separate gates.

With local `artifacts-before/result.json` and `artifacts-after/result.json` present,
`node e2e/meet/network/compare.mjs` writes a recorded HTML/JSON comparison. These are
separate runs and endpoint screenshots, not a controlled throughput comparison.
Optional `MEET_NETWORK_BEFORE=1` also needs original module copies under
`artifacts-before/sources`. Earlier single-layer recordings made before relay queue
corrections are not evidence of usable poor-network behavior. Raw historical
captures remain local; the current run's assertions determine its verdict.
