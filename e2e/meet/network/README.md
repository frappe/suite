# Meet impaired network audit

This harness routes actual Chromium WebRTC UDP through a local userspace relay and
samples the real Meet receiver once per second. It limits bandwidth, delays packets,
and drops packets without root privileges or changing the host internet connection.
The existing camera-demand fixture supplies four moving 320×240 cameras at 25 fps,
one screen of the same size, and one oscillator audio track. The receiver uses the
production SFUMeetingManager, ParticipantConnection, media managers and MeetingLayout.

## Run

From the repository root, with the root, frontend, e2e and SFU dependencies installed:

```bash
node e2e/meet/network/run.mjs
node --test e2e/meet/network/*.test.mjs
```

On this host the packaged mediasoup worker crashes with SIGILL. The audit used an
existing locally built worker, whose SHA-256 is recorded in the result:

```bash
MEDIASOUP_WORKER_BIN=/home/t3code/.local/share/suite-ship-transcription-20261027/real-ui/mediasoup-worker \
  node e2e/meet/network/run.mjs
```

A compatible worker can also be built using the installed mediasoup package's
`worker:build` script; see `../camera-demand/README.md`. Output defaults to
`artifacts/result.json` and `artifacts/server.log`. Set `MEET_NETWORK_OUTPUT` to
keep separate runs. Runtime is approximately two minutes. Ports 4317 and 4318 TCP
and 44170 UDP on 127.0.0.1 and 127.0.0.2 must be free. The runner owns and stops its
SFU, Vite server, browser and UDP sockets, uses temporary random signing secrets,
and checks that SFU Producer and Consumer counts return to zero.

## Profiles and assertions

| Profile | Download | Upload | Added round trip delay | Random loss | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | Unlimited | Unlimited | 0 ms | 0% | 8 s |
| Slow | 512 kbps | 256 kbps | 300 ms | 5% | 15 s |
| Severe | 128 kbps | 64 kbps | 800 ms | 20% | 15 s |
| Restored | Unlimited | Unlimited | 0 ms | 0% | 30 s |
| Media blackout | Unlimited | Unlimited | 0 ms | 100% | 10 s |
| Restored after blackout | Unlimited | Unlimited | 0 ms | 0% | 25 s |

Bandwidth uses decimal kilobits and includes UDP payloads for RTP, RTCP, ICE and
DTLS. Upload and download have separate aggregate byte budgets. Each direction
adds half the stated round trip delay. Packets whose queue service time would exceed one second are
dropped; propagation delay is separate. Dropped packets reserve no bandwidth; congestion loss therefore adds to configured seeded random loss. Profile
changes flush queued packets. This models a bounded queue, rather than preserving
an arbitrarily large backlog after the connection improves.

Publishers establish their four send transports in order before the real Meet
receiver joins. The first four relay UDP flows bypass impairment; subsequent flows,
including receiver ICE restarts, are impaired. No publisher receive transports are
connected. Relay counters exclude bypassed publisher flows. This ordering is part
of the fixture contract and must be revisited if the fixture gains more transports.
Signaling stays healthy, and the receiver publishes no local media.

Exit 0 requires all six receiver streams to advance bytes, and all five video
streams to advance decoded frames, in the final three seconds of baseline and both
restoration windows. The blackout must drop actual relay packets and stop all RTP
byte counters. Page errors or failed cleanup also fail the run. Slow/severe windows
are measurements: poor media there is recorded rather than assigned an arbitrary
quality pass threshold. Full RTC reports, per-second samples, quality/recovery
events, relay counters, source hashes, Git revision and browser version are retained.
`assess.mjs` also calculates maximum observed consecutive stall duration per stream.
Audio-byte progress proves packet delivery, not intelligibility.

## Fidelity and limits

This is an isolated media integration audit, not the full Frappe application.
Participant tiles and other presentation components are stubs inherited from the
camera-demand fixture. Warning visibility, chat, joining while impaired, actual
speech quality, real screen text, local publishing recovery, signaling outages,
TURN/TCP fallback, jitter/reordering, mobile browser behavior, and long outages need
separate coverage. Short synthetic windows do not establish production call quality.
See the fixture README for its substitutions.

An initial negative control using Chromium's deprecated
`Network.emulateNetworkConditions` continued receiving every stream even at 100%
configured loss. Its `impairmentEffective` assertion failed. Browser throttling
command acceptance is therefore insufficient evidence of WebRTC impairment in this
setup. The relay's packet counters and blackout assertion independently verify that
the tested media path is actually affected. Chrome documents the packet-loss field
in its [Network protocol](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-emulateNetworkConditions).

## Indicator fix and recorded comparison

The visible UI remains the original warning icon and tooltip. No header status or
checking/reconnecting label is added.

The current runner mounts the production `NetworkIndicator.vue` with the production
`useNetworkQuality` composable and media-health monitor. It asserts the actual DOM
visibility at the end of every profile: hidden for baseline/restoration, a warning for
slow/severe/blackout. It also verifies Consumer-to-Producer identity and handles
counter resets when recovery replaces Consumers. Cleanup is checked separately.

The latest run passed all 12 recorded checks plus zero-resource cleanup. Focused
verification passed the frontend health, indicator and SFU tests, plus five harness tests.
`artifacts-after/result.json` retains per-second media and indicator observations;
`artifacts-before/result.json` is the pre-fix recording captured in this workspace.
The old indicator omitted a warning in the slow and blackout windows. The new
indicator warned in both, remained in recovery while delivery was unhealthy, and
hid the warning after sustained media progress. Premature healthy recovery events
during impairment fell from two in the original recording to zero.

Generate the interactive recorded comparison from those artifacts:

```bash
node e2e/meet/network/compare.mjs
```

This writes `artifacts-after/comparison.html` and `comparison.json`. The comparison
shows recorded profile endpoints, not a live call or a media quality benchmark.
Before and after are separate executions of the same impairment profiles, so media
throughput is not a controlled performance comparison. The original health-module
source copies are retained under `artifacts-before/sources` for provenance; these
ignored local artifacts are required for the optional `MEET_NETWORK_BEFORE=1`
recording mode. The normal audit command exercises current product code.

The local warning criteria are poor at ≥5% recent packet loss, ≥450 ms RTT,
≥40 ms jitter, or camera decoding below 5 fps; critical at ≥18% loss,
≥1200 ms RTT, ≥150 ms jitter, a confirmed six-second camera/audio stall,
or an offline/failed connection. Poor changes are smoothed over consecutive polls;
clearing a warning requires six healthy seconds. Screen content and intentional
pauses have separate handling to avoid false alarms.

The implemented policy is:

- Upload uses fresh SFU feedback exposed in browser `remote-inbound-rtp` stats;
  download uses recent inbound packet-loss windows and actual Consumer progress.
- Unbound probation streams and RTX/FEC reports do not contaminate media quality.
  Jitter from inactive reports is ignored. Loss counters reset per transport/SSRC.
- A poor measurement must persist across polls to replace a known good state;
  returning to good requires six seconds of healthy observations. Confirmed stalls
  and transport failures raise warnings promptly. Missing measurements become
  checking, never an invented good state.
- Camera/audio byte or decode stalls use a six-second threshold. Static screens
  are handled separately; intentional producer, Consumer, and adaptive pauses do
  not count as network stalls. Missing expected subscriptions also warn.
- A successful ICE control operation does not emit healthy. Recovery reporting
  waits for sustained observed delivery/feedback for the affected connection.
- Offline and unavailable signaling have explicit states. The existing tile icon and tooltip appear only for poor or critical quality.
  Header layout and visibility are unchanged. Checking, good, and unknown states
  have no indicator UI.
- Remote upload scores use stable participant IDs with current-connection ownership
  checks. One SFU timer refreshes live scores every five seconds. The frontend expires
  remote evidence after 15 seconds and hides the icon when unmeasurable.

A broader frontend Vue typecheck still reports existing repository errors (including
unrelated calendar UI and existing Meet RTC snapshot/screen-share typing). The new
health tracker, monitor, composable and indicator have no diagnostics in that check;
the complete frontend typecheck is not a passing gate for this change.

## Original audit results on 29 October 2026

The receiver-only run exited 0. Baseline and both restoration windows passed the
final-three-second RTP and decoded-frame checks for all six streams. The blackout
passed the actual-packet-drop check. Cleanup returned all Producer and Consumer
counts to zero. Four focused harness tests passed. Detailed evidence is in
`artifacts/result.json`; the compact calculation is in `artifacts/summary.json`.

| Scenario | Received RTP payload | Decoded fps per video stream | Longest observed video stall |
| --- | ---: | ---: | ---: |
| Baseline | 480.5 kbps | 25.1–25.2 | 0 s |
| Slow | 86.1 kbps | 1.8–3.4 | 13.4 s |
| Severe | 5.8 kbps | 0 | 15.4 s |
| Restored | 575.6 kbps | 18.3–22.4 | 4.1 s |
| Media blackout | 0 kbps | Buffered frames only | 10.3 s |
| Restored after blackout | 596.2 kbps | 22.5–23.4 | 2.1 s |

Rates are elapsed-window receiver RTP payload measurements, not the configured
link cap. Restoration fps includes time spent recovering. Decoding already buffered
frames during blackout does not indicate network delivery. Stall durations have
approximately one-second resolution. The slow/severe audio stream advanced only
8,019 / 648 bytes respectively across approximately 15 seconds, versus 33,553 bytes
in the roughly eight-second baseline; this cannot establish usable speech.

### Findings

1. **Poor network feedback needs correction.** The receiver-only run emitted no
   `onNetworkQualityUpdated` event despite long freezes and a failed receive
   transport. The earlier all-peers impairment run did emit quality events, but
   their participant IDs were socket IDs rather than fixture user IDs `a`, `b`,
   `c`, `d`, `receiver`. The SFU forwards `peerId` as `participantId` in
   `suite/meet/sfu-server/src/server/SocketHandlerManager.ts` (network-quality
   callback); full-access peer IDs are initialized from `socket.id` in
   `server/handlers/RoomJoinHandlers.ts`. The frontend's `ParticipantManager`
   indexes by participant/user ID, and `useSFUConnection` compares the quality ID
   to the local user ID. These IDs need mapping before quality updates can reach
   those lookups. Production warning rendering remains an inference from this
   code path because this fixture substitutes ParticipantTile.
2. **Recovery state can say healthy while media is frozen.** During the slow
   profile the real receiver emitted `recovering_receive`, then `healthy` 41 ms
   later. During the severe profile it emitted the same transition 36 ms apart,
   with reason `transport_recv_failed`. Every video decoded zero frames throughout
   that severe window. Successful recovery control operations therefore do not
   establish healthy delivery. Gate user-facing recovery success on observed media
   progress, or distinguish completed control operations from resumed media.
3. **Severe impairment makes the tested call unusable.** Five low-resolution video
   streams froze entirely, and audio packet delivery nearly stopped. Investigate
   receiver bandwidth adaptation and audio continuity with real speech before
   declaring support for these conditions. A 512 kbps cap with 5% random loss plus
   queue loss already produced multisecond freezes; it is not a smooth degradation
   in this workload.
4. **Restoration worked in the isolated receiver run.** After the severe profile
   and after a ten-second media blackout, every stream resumed without a reload,
   with stable Consumer IDs across sampled windows. This is one bounded successful
   receiver run. An earlier run impairing raw synthetic publishers as well did not
   recover, so it is not evidence about production publisher recovery.

### Next audit coverage

Prioritize a full-app test that asserts visible local/remote quality warnings and
recovery status against actual decoded progress. Then add real Meet publishing
clients, real speech with audio continuity/intelligibility scoring, joining on an
already weak link, signaling disconnect/rejoin, and TURN fallback. Keep separate
expectations for eventual recovery and media quality while the link is impaired.

## Full call video

Set `MEET_NETWORK_VIDEO=1` to record `meet-full-call.webm` at 1440×900.
This mode uses the real ParticipantTile, name pills, warning icon, toolbar buttons
and Meet icons with the built frontend stylesheet. The fixture assembles the call
shell; it does not run Frappe's authenticated Meeting page. Toolbar actions are
presentation only. It replaces the synthetic color cameras with the WebRTC samples
Chrome animation (downloaded to the ignored output directory), omits screen sharing,
and keeps the diagnostic panel hidden. A small caption identifies the network phase.
The same actual UDP relay applies the impairments, and camera recovery is measured.
Run after building the frontend so `suite/public/frontend/assets/index-*.css` exists.
No product UI files are changed by this recording mode.

`MEET_NETWORK_VIDEO=1 MEET_NETWORK_POOR_DEMO=1` records a distinct usable-poor-link
case: 15 seconds healthy, 45 seconds at 1.5 Mbps down / 512 kbps up with 500 ms
added RTT and no random loss, then 25 seconds restored. Cameras publish VP8
simulcast through the production TransportManager (including camera motion and
audio priority preferences). Sender parameters are saved in the result. The bounded queue is 100 ms, separate from propagation delay.
The poor-case assessment requires at least five seconds of timestamped evidence,
continuing audio delivery and decoded samples (under 10% concealment), and all four
videos decoding at least ten frames. Audio and video may not stall for over two
seconds within that window. Baseline and recovery require both flowing video and
decoded audio. An observed resolution reduction and a sustained `poor` icon are
also required. The browser must report the expected camera motion and audio
priority settings; those settings are checked, not just saved. Fixture patches
fail if their source anchor is missing or ambiguous. Packet delivery does not establish speech
intelligibility: the source audio is an oscillator, and Playwright video is silent.
The earlier full-call clip used single-layer cameras and a relay queue defect;
it should not be used as evidence of usable poor-network behavior.


## Motion-first media policy

Camera senders request `motion` and `maintain-framerate`; screen senders retain
`detail` and `maintain-resolution`. Sender encoding priority and network priority
are high for audio and low for video, where the browser accepts those hints.
Browsers rejecting priority hints retry the video degradation preference alone.
Camera replacement tracks keep the same content hint. Simulcast camera caps are
120/500/1800 kbps, with no artificial low frame-rate cap on the base layer.

The SFU keeps independent congestion estimates for each receiver transport.
It gives speaking cameras video priority 2, other cameras 1, and leaves audio and
screen-share priorities alone. It restores camera priorities on silence and applies
the current speaking state to newly created consumers. Selecting a lower spatial
layer without an explicit temporal cap requests the highest available frame rate.
Mediasoup's native simulcast/SVC allocator remains the congestion controller,
including its conservative upgrade period after bandwidth-driven downgrades;
there is no second controller driven by the network warning icon.

The `artifacts-motion-policy` run passed all eight integration checks. In its last
five seconds under impairment, camera decode rates were about 21–25 fps, three
cameras used 160×120, and audio concealment was approximately 0.4%. This validates
one Chromium receiver impairment profile, not speech intelligibility or poor
publisher uplinks. The recording uses sample cameras and synthetic audio.


### Cleanup review verification

`artifacts-review/result.json` passed all 11 live checks under the stricter
assessment, including recovered audio and actual browser sender settings.
The active-speaker test now holds a worker priority update pending while silence
arrives; it verifies the camera eventually returns to normal priority. Negative
media traces reject burst-then-freeze progress, missing/concealed recovered audio,
and missing or insufficient timestamp evidence. Unit sender-parameter tests cover
the external WebRTC contract and preservation of arbitrary encoding limits; real
UDP delivery and decoding remain the behavioral proof.
