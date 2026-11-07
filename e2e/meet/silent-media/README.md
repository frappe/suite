# Silent audio qualification

From the repository root, install root/frontend, `e2e`, and
`suite/meet/sfu-server` dependencies with their lockfiles, then install the
Playwright Chromium and Firefox browsers through `e2e`.

```bash
node e2e/meet/silent-media/run.mjs
MEET_BROWSER=firefox node e2e/meet/silent-media/run.mjs
MEET_ESCALATE=1 node e2e/meet/silent-media/run.mjs
MEET_ESCALATE=1 MEET_BROWSER=firefox node e2e/meet/silent-media/run.mjs
```

Run sequentially. Ports 44317 (isolated SFU HTTP), 44318 (Vite), and 44319
(native SFU UDP) must be free. HTTP binds loopback; media binds the first local
non-loopback IPv4 address, because Firefox does not pair its non-loopback host
candidates with the SFU's loopback address. No host network settings change.

Three production Meet managers publish synthetic audio. Native sender detachment
stops actual RTP while captured audio stays active. Escalation mode additionally
holds the first native track restoration, forcing directional ICE restart and
republication; the captured track ID must survive. An isolated SFU preload
pauses one native Consumer over process IPC. It adds no production server route.

Every fault window checks exact identities and increasing RTP on all unaffected
paths. Affected received bytes and energy must stop and recover. Three further
windows check every path. Native receive SDP observations cover the remote offer
through completion of the local answer; stats must belong to one settled epoch.
A counter decrease is accepted only across a completed epoch with positive new
RTP. Missing/zero reports never prove progress. Normal mode also verifies muted,
silent/DTX and intentionally paused microphones cause no repair on any peer.

Linux Firefox needs a working audio backend for WebAudio. `run-firefox.sh` can
use an existing read-only extracted runtime via `MEET_AUDIO_DEPS`, containing
`pulse-deps/root` and `firefox-deps/root`. It creates its own socket, configuration
and PulseAudio process under ignored `.runtime/`, and closes the owned process
on exit. Without that variable it uses the system runtime. It does not install
packages, share another project's PulseAudio process, or change a system service.

These are synthetic RTP/decoded-energy proofs, not physical audibility tests.
Permanent faults and exhaustion have deterministic monitor tests; this harness
qualifies successful native repairs. The default run is audio-only; shared-transport mode also checks cameras.

## Shared receive transport parity

```bash
MEET_RECEIVE_TRANSPORT=1 node e2e/meet/silent-media/run.mjs
```

This mode publishes cameras as well as audio, declares camera demand, and checks
all 18 paths. The IPC fixture blocks every native Consumer on one receiving
transport, including future Consumers created on that same transport. Only a
replacement receive transport restores delivery. Four affected receive paths
must regain RTP plus audio energy/video decode; the other 14 paths must retain
identity and advance in every window. Three complete post-repair windows follow.
Native video sender counters aggregate all simulcast encodings.

Chromium qualified on both baseline and branch. Firefox shared-video qualification
failed before fault injection or on unaffected-video progression on both versions;
no Firefox shared-video parity claim is made. Audio-only Firefox faults qualified.
