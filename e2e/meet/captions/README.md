# Meet caption evaluation

This harness plays a recorded speech clip into a guest's microphone stream in
the real Meet web app and measures captions rendered in a second participant's
browser. Each clip gets its own room and browser contexts. Reference transcripts
come from the manifest; neither recognition output nor model prompts supply the
expected answer.

The exercised path is Web Audio capture source → Meet audio processing → WebRTC
and Opus → SFU audio ingestion and VAD → configured STT service → SFU caption
delivery → observer's rendered caption overlay. The harness replaces
`getUserMedia` audio with a controllable Web Audio track, so it does not measure
physical microphones, room acoustics, or native microphone capture processing.
It does not inject captions, fake SFU responses, or call the STT endpoint directly.

## Requirements

- An isolated Frappe test site running the current frontend, with the existing
  Meet E2E test helpers enabled, plus its SFU. The setup provisions the existing
  Meet test host and creates rooms, so use a disposable test site.
- The SFU configured with `STT_SERVER_URL` and `STT_API_KEY` pointing to the
  inference service being evaluated. Development's mock STT fallback cannot
  establish recognition quality. Confirm the deployed backend and checkpoint
  independently; seeing captions in the UI does not identify the model.
- Playwright Chromium: run `yarn install --frozen-lockfile` and
  `yarn playwright install --with-deps chromium` from `e2e/`.
- Speech recordings and independently reviewed reference text. Keep recordings,
  manifests, and results outside git. Separate evaluation speakers and meetings
  from fine-tuning and prompt-selection data.

## Live evaluation

Copy `manifest.example.json` outside the repository and replace its illustrative
audio path, reference, speaker, and any available timing annotations with reviewed recordings.
The example deliberately has `consented: false` and is not runnable as supplied.
For licensed datasets, provide `datasetLicense` and `sourceUrl` instead of
asserting recording consent. Audio paths are relative to the manifest. Speech
times, when supplied, are seconds from the start of the file; the last spoken sound may precede
the end of the audio. `names` is a scoring list, not an injected room roster or
decoder prompt. Use nonoverlapping names in this list.

```sh
BASE_URL=http://localhost:8098 \
SFU_URL=http://localhost:3000 \
MEET_CAPTION_MANIFEST=/private/captions/manifest.json \
MEET_CAPTION_REPORT=/private/captions/baseline.json \
MEET_CAPTION_MODEL_LABEL=nemotron-baseline-revision \
yarn --cwd e2e test:meet-captions
```

The existing global setup uses `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` to
provision the test host (local defaults: `Administrator` / `admin`). Use the
credentials appropriate to the isolated test site. `SFU_URL` is its health-check
address; the application's normal connection metadata selects the media server.

Set `MEET_CAPTION_THRESHOLDS` to a JSON object to choose acceptance criteria:

```sh
export MEET_CAPTION_THRESHOLDS='{"maxFailed":0,"maxWer":0.2,"minAttributionAccuracy":1,"maxFinalAfterSpeechP95Seconds":2}'
```

The example criteria are a proposed test gate, not established model performance.
Without an override, the gates are zero failed clips, WER at most 0.30, and
correct attribution for every clip. These defaults are a starting point for
evaluation, not a claim of parity with another product.
Available gates also include `minNameRecall`, `maxFalseNames`,
`maxFirstTextP95Seconds`, and `maxFirstTextAfterSpeechStartP95Seconds`. A requested
latency gate fails if any expected clip lacks that measurement. Missing captions
must not disappear from averages. The report contains scores and run metadata;
it omits references, predicted text, and audio paths. Browser traces, video, and
screenshots are disabled for the live corpus run.
By default the report is written to `e2e/meet/test-results/captions/report.json`,
which is ignored by git. Each clip includes a three-second startup settling
period followed by the full recording and a fifteen-second caption collection
window. This measures steady-state captions after subscription setup, not the
time it takes to enable captions.

## Interpreting results

Word error rate uses normalized words and preserves Unicode combining marks.
Missing clips remain in the denominator and count as failures. Attribution checks
the speaker label actually rendered with the caption. Name scores count exact
normalized phrases, including supplied names that were not spoken; they cannot
detect every possible wrong name outside that list.

Timing is observed in the browsers on the same machine. First text is measured
from playback start, and final delay from the annotated last spoken sound. These
include the app's processing, network delivery, and DOM updates; they are not
GPU inference timings. A MutationObserver records DOM updates, not the exact
display scanout time. Scheduling, browser audio buffering, and wall-clock changes
limit precision. Do not compare first-text measurements across clips without
accounting for leading silence.

Speech cases require a nonempty reference and use one speaking guest and one
listening host per clip. Explicit non-speech controls are described below. It does not establish accuracy under overlapping speakers, large-room load,
reconnects, or caption subscription changes. Those require separate scenarios.
Replay the same recordings, with the same references and comparable settings,
through another product to make a head-to-head claim.

## Harness checks

```sh
yarn --cwd e2e test:meet-captions-unit
yarn --cwd e2e test:meet-captions-smoke
```

The first command tests scoring against independent expectations. The second
uses real Chromium to test audio injection and caption observation without a
Meet server or GPU. Neither command measures model quality or proves the whole
Meet deployment works. The dedicated CI workflow runs these harness checks;
the live evaluation requires the services and speech dataset above.

## Paired pipeline diagnostics

The ordinary summary also records the SHA-256 of the exact source bytes injected
into each microphone, decoded duration/channels/sample rate, AudioContext sample
rate and track settings, plus the Chromium version. These identify the input and
capture configuration without including audio, transcripts, room IDs, or paths.
Use `MEET_CAPTION_RUN_SETTINGS` to record a JSON object of operator-verified
settings (for example language, checkpoint revision and attention context).
This is a label, not automatic verification of the backend; include no credentials.

Set `MEET_CAPTION_RAW_REPORT=/private/captions/raw.json` to explicitly retain a
separate private diagnostic artifact. It contains rendered partial/final text,
caption and participant IDs, room IDs, playback timestamps, predictions, source
hashes and capture settings. It is written with mode `0600`; transcripts remain
excluded from the ordinary summary. Keep this file outside git and use a distinct
path from `MEET_CAPTION_REPORT`. No raw artifact is written by default.

For a paired capture with the SFU's room-scoped diagnostics, create a disposable
room first and set `MEET_CAPTION_ROOM_ID` to its ID. This override requires a
single-clip manifest so recordings cannot overlap across cases. Configure the
SFU's diagnostics allowlist for that room before starting the evaluation. Raw
browser observations contain the rendered speaker participant ID for correlation
with the SFU capture. Replay the same source hash and references for each setting;
a new run's wall-clock timestamps are not directly comparable.

Final caption aggregation deduplicates repeated observations of the same caption
ID, while preserving repeated spoken utterances with different IDs. Its latency
uses the first appearance of a final, even if that final line is observed again.
A visible unfinished draft at the end of the collection window makes the clip
fail even when earlier utterances have finals. First-text latency measures the
first displayed text regardless of its attribution; attribution is scored
separately. The rendered overlay does not expose authoritative empty finals or
utterance IDs. A disappearing draft can therefore be an empty final or another
UI removal; this harness cannot prove that every utterance finalized. Mutation
batching can also miss short-lived states. Use the SFU diagnostic event timeline
to investigate these cases rather than inferring completeness from DOM alone.

Speech annotations may be omitted or null for corpora whose speech boundaries
have not been independently reviewed. Such runs report no speech-relative first
text or final timing, and any requested speech-relative latency gate fails.
`finalAfterAudioSeconds` is a separate diagnostic measured against file duration;
it never substitutes for speech-end latency. The live corpus harness restricts
recordings to 15 seconds and collects a full 15-second tail after actual playback
ends; file duration controls collection rather than missing speech annotations.
Every supplied start or end annotation must fit within the decoded recording,
including when only one annotation is supplied.

For multiple clips, `MEET_CAPTION_ROOMS_JSON_FILE=/private/captions/rooms.json`
loads a private JSON object mapping each clip ID to its precreated room ID, for
example `{"english-1":"room-a","hindi-1":"room-b"}`. It must contain exactly
all manifest IDs, with unique nonempty room IDs. It is mutually exclusive with
`MEET_CAPTION_ROOM_ID`. Configure the diagnostic room allowlist with these exact
rooms before starting the SFU, rather than restarting it between captures.
The mapping file's path and room IDs are absent from the ordinary report.

## Paired endpoint and Meet scoring

Use the same recorded WAVs and references for the direct endpoint run and Meet.
The direct harness's `--save-predictions` exports a JSON object keyed by clip ID;
the Meet run's `MEET_CAPTION_RAW_REPORT` supplies rendered predictions and the
hash of each injected audio file. Prepare a direct input-evidence JSON object
with `audioInputs: [{id, sourceAudioSha256}]`, hashing the exact WAV bytes replayed,
and `operatorSettings` containing `modelImageDigest`, `modelRevision`, `language`,
`sampleRate`, and `nameHints`. Supply the same settings through
`MEET_CAPTION_RUN_SETTINGS` for Meet. Name hints must describe the actual room
roster forwarded to STT, not the manifest's name-scoring list.

```sh
node e2e/meet/captions/compare.mjs \
  --manifest /private/captions/meet-manifest.json \
  --direct-predictions /private/captions/direct-predictions.json \
  --direct-inputs /private/captions/direct-inputs.json \
  --meet-raw /private/captions/meet-raw.json \
  --output /private/captions/paired-report.json
```

This uses one scorer for both paths, preserves failed clips, rejects changed
source audio or mismatched manifest identities, and reports differences per
clip and scenario without copying transcripts into its output. A browser failure
can leave injection evidence unavailable; it still contributes to the error and
failure counts, while preventing a source-parity claim. Matching operator settings
are declarations, not verified backend identity. Correlate the SFU's accepted
session settings, captured audio/commits, and authoritative finals before assigning
an observed difference to audio processing, VAD, STT delivery, or rendering.
Summary and scenario groups include `directControls` and `meetControls` counts
and evidence coverage. Unobserved interim or final metrics are null, and groups
without speech have explicit null WER. Direct final transcripts alone cannot
establish that interim captions were clean.

Each clip logs its corpus ID, current browser phase, and captured/failed status.
Failures record a finite phase and category in the summary, without emitting raw
browser exception text, private paths, room IDs, or recognized text. Choose opaque
manifest IDs. A failed infrastructure phase is a harness failure, not evidence of
recognition error; investigate it before interpreting corpus WER.

Opt-in raw diagnostics also sample browser publication before and after playback:
WebAudio state and peak source amplitude, injected track state, peer connection
and ICE state, audio sender track state, and selected outbound/media-source RTP
statistics. The observer records only numeric counters and state enums, excluding
SDP, candidates, network addresses and raw browser exceptions. Source amplitude
is sampled every 100 ms; it is a diagnostic peak, not a calibrated recording
level. Packet counters and accumulated audio energy help distinguish a working
fixture from an interrupted WebRTC or downstream SFU/FFmpeg path. Diagnostic
instrumentation runs only when the private raw report is requested.


## Silence and non-speech controls

A control clip must explicitly declare `"expectSpeech": false` and `"reference": ""`.
It cannot have speech timing annotations. The default is a speech clip, which
still requires reference words; an empty reference never silently changes a
speech case into a control. Controls use the same licensed/consented audio checks,
normal microphone path, complete recording and 15-second collection tail. No
synthetic expected text or final caption is injected. Supply silence, background
noise or other verified non-speech recordings separately from quiet speech.

A completed control with no rendered text succeeds without a final. Any
meaningful partial or final caption makes it fail, including an interim that
subsequently disappears after an empty final. Placeholder `...` lines are not
recognized speech. Reports separate `speechClips` and `nonSpeechClips`,
`failedSpeech` and `failedControls`, and `missingControls`; `missing` counts
missing speech predictions. An absent control prediction is a failed capture,
not evidence that silence produced no text.

`falseCaptionClips`, `falseInterimCaptionClips` and `falseFinalCaptionClips` count
controls that displayed text; `falseCaptionWords` counts words in control final
transcripts. Speech WER, name recall, attribution and latency denominators exclude
non-speech controls. A controls-only corpus has null WER/attribution and no speech
latency samples. Its default gate is zero failed clips and zero false-caption
clips. Mixed corpora also retain the default speech WER and attribution gates.

Set `maxFalseCaptionClips`, `maxFalseInterimCaptionClips` and/or
`maxFalseFinalCaptionClips` for explicit hallucination limits. The first two
require interim observations for every control: final-only predictions cannot
prove that interims were clean. The final-only gate also requires final evidence for every control; failed
captures with no such evidence cannot pass. A completed interim-only
hallucination can pass the final-only gate while failing interim or overall
gates. Browser predictions include observation counts even when zero. The raw diagnostic transcript export remains opt-in; ordinary reports
contain counts and scores only.

Controls additionally verify working browser publication after the complete
collection window: a connected peer must have a live enabled audio sender, and
both outbound audio packet and byte counts must increase from the pre-playback
snapshot. This runs even when raw export is disabled; the ordinary report stores
only `publicationVerified`, while detailed snapshots remain private and opt-in.
Zero audio energy is valid for silence. Missing publication is classified as
`audio-publication`, so a broken microphone/WebRTC path cannot pass simply because
no captions appeared. This verifies browser transmission, not reception by the
SFU; paired runs should also verify nonempty before-VAD PCM captures.
