# Silent media port: evidence and behavior parity

Verified locally on 2026-11-06/07. All checkout changes and test services were
confined to this worktree. No other Suite checkout or shared Frappe site was used.
Raw logs are **local, untracked** under `.scratch/silent-media-logs/`; they are not
part of this branch. Key commands, exits and results are reproduced below.

## Revisions and comparison method

- Before: local `origin/develop`, `6eca7ffa7899742403dc6a67032db0e32f1bffe6`.
- Product and regression tests: `06df27067` (`feat(meet): detect silent audio and preserve recovery escalation`).
- Native fault harness and counter-aware network assessment: `b656d100f`.

Before runs used the original frontend subtree restored from `origin/develop`
**in this worktree**, with the branch subtree saved locally and restored after
all baseline processes finished. Existing SFU/server/recorder code was unchanged.
The new silent-media harness was retained to exercise both implementations.
Baseline source equality was checked with
`git diff --quiet origin/develop -- frontend/src/apps/meet` (exit 0).
Tests ran on the working changes before the clean history rewrite. Subsequent
formatting and an identity guard received the final unit/policy checks below.

This is qualified parity for the executed tests, **not a complete app parity
certification**: authenticated app e2e setup was unavailable, and the Firefox
shared-video fixture did not qualify. Those limits are not reported as passes.

## Behavior parity

| Behavior touched or reviewed | Before (`origin/develop`) | After (branch) | Verification and limits |
| --- | --- | --- | --- |
| Active microphone with stalled RTP | No source-aware sender detector | Positive source energy plus live/enabled/unmuted/unpaused track and flat RTP; reattach → send ICE → republish retained track | Native sender detachment: baseline fails unaffected-path preservation; branch Chromium and Firefox restore RTP/energy. Full ladder exercised in Firefox and in the original Chromium qualification. |
| One established audio Consumer stalls | Whole receive transport reset; healthy consumers replaced | Repair that consumer first; healthy identities remain | Branch single-consumer Chromium/Firefox faults pass; baseline sender-fault runs expose replacement of an unaffected consumer. |
| Shared audio/video receive transport stalls while ICE stays connected | Audio stall triggers receive reset | Correlated active-audio/camera stalls reset the receive transport without waiting through separate ladders | Chromium native transport-scoped impairment passes before and after, including cameras and all unaffected directions. First restored media: 12.588s → 8.365s. Firefox shared-video is unqualified. |
| One path stays broken after consumer repair | Transport reset | Three consumer repairs → one receive-transport reset → bounded give-up | Public monitor regression verifies one fallback and finite attempts across consumer replacements. Permanent native-blackhole exhaustion is not browser-qualified. |
| Transport ICE failure/disconnection | Existing directional ICE/lifecycle recovery | Existing path retained; correlated/stalled-media escalation supplements it | Existing recovery unit suites pass before/after; UDP blackout restores all six network-fixture streams. Authenticated reconnect e2e blocked at setup. |
| Reconnect/rejoin with retained capture | Existing Participant Connection generation/ownership and publication recovery | Preserved; a new publication can re-arm an exhausted sender even with the same retained track | Rejoin regression red→green; ParticipantConnection/Recovery and SFURecoveryManager unit suites pass. Full app rejoin unverified. |
| Mic toggle / intentional pause | Paused media excluded; explicit UI operations control intent | Intentional pause clears sender incident; unmute can re-arm repair; receiving pause clears that path's incident | New toggle regression and native muted/silent/pause controls pass; existing media-control units pass. Full app toggle e2e unavailable. |
| Audio device/track change | Existing serialized track replacement | Existing replacement retained; new track identity re-arms health and replaces private analyser | Device identity regression red→green; existing publication/track tests pass. Physical device switch unverified. |
| Participant departure / subscription cancellation | Lost-consumer recovery checks participant presence and desired subscription | Restored those checks around server closure; identity guard rejects samples removed during await | Two departure/stale-sampling regressions red→green; CameraSubscriptions and ParticipantConnectionEvents units pass. `multi-participant`/connection-switching app e2e unavailable. |
| Screenshare | Existing publication ownership, stop fencing, static-screen handling | Unchanged; receive transport fallback rebuilds the existing desired inventory including screens | Network test restores four cameras, one screen and audio before/after; screen lifecycle unit tests pass. App screenshare navigation unverified. |
| E2EE subscriptions (#1119) | Existing epoch/context/transform and ownership fencing | Repair uses the same createConsumer/createProducer and receive-reset paths; context checks and transforms remain | TransportManager readiness/E2EE, handshake/context/epoch, ParticipantConnection, and SFU server suites pass before/after. Real encrypted-room browser qualification unavailable. |
| Receiver readiness (#1081) | Consume → install transform → readiness/resume; failed/stale allocations closed | Preserved; SDP guard observes native promises without bypassing readiness | Existing TransportManager failure/stale/ack/readiness tests pass; real video receive reset succeeds in Chromium. App readiness fault suite setup blocked. |
| Camera demand/layers (#1107) | Server/client camera demand and priority policy | Same desired inventory and layer controller used after reset | CameraSubscriptions/CameraLayerController and server CameraLayerDemand tests pass; network camera streams restore. No standalone `camera-layers` e2e entry exists at this baseline. |
| Network warnings (#1101) | Recent quality windows, unknown-measurement preservation, six-second healthy hysteresis | Thresholds retained; one-second health polling; outstanding audio warnings survive missing evidence and SDP changes | All 12 network checks pass before/after, including actual warning DOM in blackout and hiding after restoration. Intermediate warning regression was fixed test-first. |
| Minimal degraded notice | NetworkIndicator displays poor/critical network evidence | Also displays a detected media degradation when network counters remain good | Component regression red→green; existing indicator cases retained. |
| Recording / recorder clients | Separate recorder controller/rendering/projection path | No recorder or production server changes; no microphone analyser added to recorder clients | All frontend recorder and recording unit tests pass before/after, plus server recording-grant tests. Actual recording/recorder e2e not executed. |
| Stats sampling / diagnostics | Existing public stats samples and issue report | Bounded reads, receive SDP epoch guard, typed audio states and bounded repair ring in existing report | Epoch, silence, warning and formatter regressions pass. Real Report-an-issue UI navigation not executed. |

The receive gate intentionally requires fresh SFU audio-level activity, rather
than roster mic intent alone. Meet has no producer-ingress stats RPC; RTCP
remote-outbound stats describe Consumer output and are unsuitable independent
producer evidence. Activity events are fresh for two seconds; the SFU observer
reports at most 20 active speakers. Quiet sources or permanently missing activity
events can remain unknown. Recovery for a genuinely active source whose activity
signal never arrives is **not qualified**; complete parity for that case is not
claimed. This conservative gate avoids the old timer's silence/DTX false alarms.

## Exact before/after gates

Run from the repository root. `LOGS=$PWD/.scratch/silent-media-logs` identifies
local artifacts, not committed files. Native services ran sequentially with free
ports: network 4317/4318/44170; silent-media 44317/44318/44319. Firefox used its own
PulseAudio process/socket/configuration in this worktree and read-only extracted
runtime libraries from Jetbridge. No system service, sysctl or unrelated process
was changed.

| Command | Before exit / result | After exit / result |
| --- | --- | --- |
| `yarn --cwd frontend test src/apps/meet recorder --maxWorkers=2` | 0; `Test Files 67 passed (67)`; `Tests 999 passed (999)` | 0; `Test Files 67 passed (67)`; `Tests 1013 passed (1013)` |
| `yarn --cwd suite/meet/sfu-server test --maxWorkers=2` | 0; `Test Files 39 passed \| 1 skipped (40)`; `Tests 392 passed \| 2 skipped (394)` | 0; identical pass/skip counts |
| `node --test e2e/meet/network/*.test.mjs` | 0; `pass 23`; `fail 0` | 0; `pass 24`; `fail 0` |
| `MEET_NETWORK_OUTPUT="$LOGS/baseline-network-artifacts" node e2e/meet/network/run.mjs` (after uses `branch-network-final-artifacts`) | 0; all 12 `CHECKS` true; `PASS cleanup` | 0; all 12 `CHECKS` true; `PASS cleanup` |
| `node e2e/meet/silent-media/run.mjs` | 1; `AssertionError [ERR_ASSERTION]: Missing unaffected path 1/...` after the old reset | 0; `PASS chromium silent-media real faults and controls` |
| `MEET_RECEIVE_TRANSPORT=1 node e2e/meet/silent-media/run.mjs` | 0; `PASS chromium shared receive transport audio/video recovery` | 0; same pass line |
| `MEET_ESCALATE=1 MEET_AUDIO_DEPS=/home/t3code/projects/jetbridge/.dev bash e2e/meet/silent-media/run-firefox.sh` | 1; `AssertionError [ERR_ASSERTION]: Missing unaffected path 1/...` | 0; `PASS firefox silent-media real faults and controls` |
| `MEET_RECEIVE_TRANSPORT=1 MEET_AUDIO_DEPS=/home/t3code/projects/jetbridge/.dev bash e2e/meet/silent-media/run-firefox.sh` | 1; initial media readiness timeout | 1; unaffected-video progression assertion; not qualified |
| `yarn check:meet-types` | Original baseline policy was not rerun in this comparison | 0; `Meet type policy passed` |

Local logs: `baseline-unit.log`, `final-unit.log`, `{baseline,branch}-sfu-unit.log`,
`baseline-network-unit.log`, `network-verified-green.log`, `baseline-network.log`,
`branch-network-final.log`, `{baseline,branch}-silent.log`,
`{baseline,branch}-shared.log`, `{baseline,branch}-firefox-silent.log`,
`{baseline,branch}-firefox-shared.log`, and `final-types.log`.

The original network command has no single overall PASS line: its JSON contains
`"passed": true` and all twelve checks are true, followed by `PASS cleanup` and
zero native producer/consumer resources. Check names are:
`baseline`, `recovered`, `blackout-recovered`, `impairmentEffective`,
`indicator-baseline`, `indicator-slow-512k-300ms-5pct`,
`indicator-severe-128k-800ms-20pct`, `indicator-recovered`,
`indicator-media-blackout`, `indicator-blackout-recovered`,
`producerIdentity`, `noPageErrors`.
The final assessor was also replayed on **both** captured native datasets with
`assess(data.windows, {expectIndicator:true})`; both returned `passed=true` and
all twelve checks true (`assessor-replay.log`, exit 0).

### Authenticated app suites: unavailable on both versions

Exact command, on both source versions:

```sh
BASE_URL=http://127.0.0.1:44598 SFU_URL=http://127.0.0.1:44599 \
  yarn --cwd e2e test:meet \
  meet/specs/media-fault-recovery.spec.ts \
  meet/specs/sfu-reconnect.spec.ts \
  meet/specs/multi-participant.spec.ts \
  meet/specs/participant-connections.spec.ts \
  meet/specs/media-controls.spec.ts \
  meet/specs/e2ee.spec.ts --project=chromium
```

Both exit **1**, before test cases execute:
`Error: Frappe Meet did not become ready: http://127.0.0.1:44598`.
Logs: `baseline-app-e2e.log`, `branch-app-e2e.log`.
There is no isolated Frappe bench/site in this worktree. Deliberately unused ports
avoided accidentally using another checkout's service. No authentication or app
feature parity is inferred from these setup failures.

At this baseline `e2e/meet/participant-departure` and `e2e/meet/camera-layers` do
not exist. Departure coverage maps to `multi-participant` and
`participant-connections`; camera-demand's README explicitly says it is a shared
fixture, run by `e2e/meet/network/run.mjs`, not a standalone audit.

## Native media outcomes

Impairment acts on real native RTP, not substituted stats. Sender detachment
leaves captured energy present; affected outbound RTP and received RTP/energy
stop, then resume. Escalation holds the first native track restoration to force
send ICE and republishing; captured track identity must survive. Per-consumer
pause affects only one listener path. Shared mode blocks every native Consumer
on one receive transport, including new Consumers created on that transport;
only replacing that transport can restore audio and cameras.

| Passing branch case | Detection ms | First observed restored RTP/energy ms |
| --- | ---: | ---: |
| Chromium sender / reattach | 4593 | 5159 |
| Chromium single consumer | 7755 | 8259 |
| Firefox sender / complete ladder | 3244 | 11415 |
| Firefox single consumer | 6858 | 7283 |

Shared Chromium transport restoration: baseline **12588ms**, branch **8365ms**.
These are local observations after injection acknowledgement, with roughly
one-second sampling, not production bounds. Ordinary faults check all unaffected
paths in every window and three subsequent complete progress windows (nine
paths). Shared mode checks all 14 unaffected paths while four receive paths are
impaired, then three complete windows over all 18 paths. Cameras require decoded
frames as well as bytes. Receive stats are sampled within a native settled SDP
epoch; resets require a completed epoch and positive new packets/bytes.

Chromium's three ten-second negative controls pass on the branch. Result lines:
`{"browser":"chromium","control":"muted","events":[]}`,
`{"browser":"chromium","control":"silent","events":[]}`,
`{"browser":"chromium","control":"pause","events":[]}`.
Every peer's ring must be empty. The original port qualification also passed all
three controls in Firefox; this comparison's Firefox escalation mode skips them.

Firefox shared-video qualification was not obtained. A fixed thumbnail-demand
attempt also failed an unaffected-video progression check on **both** source
versions (`baseline-firefox-thumbnail-shared.log`,
`branch-firefox-thumbnail-shared.log`, both exit 1). That transient tuning was
removed; no assertion was relaxed. Its cause is not established. No Firefox
shared-video recovery timing or parity pass is claimed.

## Test-first fixes and failed intermediate gates

All commands below ran from the root; failed output was captured before each
fix. Raw logs remain local. Final combined green command:

```sh
yarn --cwd frontend test \
  src/apps/meet/components/NetworkIndicator.test.ts \
  src/apps/meet/utils/media/__tests__/MediaHealthMonitor.test.ts \
  src/apps/meet/utils/sfu/__tests__/SFUMediaManager.test.ts \
  --maxWorkers=2 --reporter=verbose
```

Exit **0**: `Test Files 3 passed (3)`; `Tests 93 passed (93)`;
`parity-verified-green.log` includes the matching named passing lines.

| Regression | Red command suffix after `yarn --cwd frontend test` | Red exit/result |
| --- | --- | --- |
| No receive fallback / explicit mic or device re-arm | `src/apps/meet/utils/media/__tests__/MediaHealthMonitor.test.ts --maxWorkers=2` | 1; `3 failed \| 39 passed (42)` (`parity-red.log`) |
| Correlated audio/video recovery too late | same file, `-t 'correlated audio'` | 1; `1 failed \| 41 skipped (42)` (`correlated-red.log`) |
| Departed participant resubscribed | `src/apps/meet/utils/sfu/__tests__/SFUMediaManager.test.ts -t 'departed participant'` | 1; `1 failed \| 40 skipped (41)` (`departure-red.log`) |
| Missing evidence clears exhausted warning | monitor file, `-t 'exhausted warning'` | 1; `1 failed \| 42 skipped (43)` (`warning-red.log`) |
| Rejoin retains exhausted budget | monitor file, `-t 'rejoin republishes'` | 1; `1 failed \| 43 skipped (44)` (`rejoin-red.log`) |
| Stale consumers trigger shared reset | monitor file, `-t 'removed during stats'` | 1; `1 failed \| 44 skipped (45)` (`stale-red.log`) |
| Degraded media invisible with good network stats | `src/apps/meet/components/NetworkIndicator.test.ts` | 1; `1 failed \| 6 passed (7)` (`notice-red.log`) |

The first combined red was followed by correcting the shared-recovery test's
3-second injected-clock window to match the existing reset deadline, then a
separate failing latency regression before implementing correlated escalation.
Green tests retain finite give-up and budget preservation across visibility,
consumer replacement, and automatic republication. Three measured progressing
samples re-arm a recovered incident; explicit user source/intent changes re-arm
sender health. Reset never reacquires capture.

The first branch network run exited **1**: `impairmentEffective: false` and
`indicator-media-blackout: false`, despite native relay zero delivery. Two
separate issues were fixed: warning state/notice preservation (above), and
assessment of counters belonging to replaced Consumers. For the latter:

```sh
node --test e2e/meet/network/assess.test.mjs
```

Red exit **1**: `blackout remains effective when receive repair replaces counters
with zero` fails (`blackout-counter-red.log`). Green exit **0**:
`pass 5`; `fail 0` (`blackout-counter-green.log`). The test additionally injects
one positive byte on a replacement and requires blackout qualification to fail.
The final assessor counts positive delivery per exact Consumer identity instead
of comparing absolute counters across replacements. Missing evidence does not
qualify; relay up/down delivery must still be zero and drops positive. No
impairment, progress, warning or restoration assertion was disabled.

Original port red→green evidence is also retained locally: targeted sender test
exit 1 (`1 failed | 34 skipped`) → exit 0 (`1 passed | 34 skipped`); expanded
baseline monitor replay exit 1 (`6 failed | 34 passed`) → final focused port
regressions exit 0 (`47 passed`); issue-report formatter exit 1
(`1 failed | 6 skipped`) → exit 0 (`1 passed | 6 skipped`). Corresponding exact
commands were `yarn --cwd frontend test
src/apps/meet/utils/media/__tests__/MediaHealthMonitor.test.ts -t 'bounds active sender'`,
that monitor file with `--maxWorkers=2`, and
`yarn --cwd frontend test src/apps/meet/utils/diagnostics/problemReport.test.ts
-t 'includes silent-media'`. These historical results are not substituted for the
current 1013-test gate.

## Scope and remaining qualification

No production SFU, recorder, E2EE protocol, layer policy, capture selection or
screenshare ownership code changed. Receive fallback reuses the existing
context/readiness/inventory lifecycle; sender repair uses the existing serialized
publication lifecycle. The analyser is private and observes already captured
tracks. Diagnostics retain at most 60 repair actions; the email includes ten.

Not verified: authenticated app e2e cases listed above, Firefox shared-video
parity, physical audibility/device switching, Safari/mobile, actual recording,
real encrypted-room browser repair, permanently missing activity signals, and
native permanent-blackhole exhaustion. Exhaustion and lifecycle fencing have
public-interface regressions; that does not replace browser qualification.
Follow-ups include those gates, video source/decode-specific detectors and
keyframe-first repair, richer UI, optional producer-ingress evidence, and separate
server work for already-closed-producer races. No original-incident cause is proved.

## History and publishing hygiene

Raw log files were copied to local `.scratch/silent-media-logs/` and removed from
the rewritten branch history, rather than deleted in a follow-up commit. Install
logs and ad-hoc comparison scripts are not tracked. The native harness and README
remain. Three conventional commits retain the original author identity.
An automatic T3 checkpoint whose sole parent/tree matched this branch's old tip
also retained its old log history; only that branch-owned checkpoint was removed.
No other worktree or checkpoint was changed, and no shared reflog expiry or garbage
collection was performed. Publishing is limited to `meet/silent-media-detectors`;
no PR or merge is requested or performed.
