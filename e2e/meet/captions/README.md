# Meet caption evaluation

Plays recorded audio through a guest's microphone track and scores captions
rendered in a second participant's browser. This exercises WebRTC/Opus,
SFU/VAD, STT and the caption overlay. Run it manually
against an isolated test deployment.

## Setup

- Run a disposable Frappe test site with the frontend, Meet E2E helpers and SFU.
  Setup provisions the test host and creates rooms.
- Configure the SFU's `STT_SERVER_URL` and `STT_API_KEY` for real inference.
  Mock STT cannot establish recognition quality.
- Keep licensed/consented audio, reference manifests and results outside git.
  Start from `manifest.example.json`; its `consented: false` deliberately prevents
  running the illustrative recording. Provide actual consent or `datasetLicense`
  and an HTTPS `sourceUrl`. Audio paths are relative to the manifest.

```sh
yarn --cwd e2e install --frozen-lockfile
yarn --cwd e2e playwright install --with-deps chromium
```

Speech clips need nonempty references and are limited to 15 seconds. Optional
`speechStartSeconds`/`speechEndSeconds` annotations must fit the recording; omit
them when boundaries are unknown. `names` supplies scoring phrases, not STT
prompts. Use opaque clip IDs because progress logs include them.

## Run

From the repository root:

```sh
BASE_URL=http://localhost:8098 \
SFU_URL=http://localhost:3000 \
MEET_CAPTION_MANIFEST=/private/captions/manifest.json \
MEET_CAPTION_REPORT=/private/captions/report.json \
yarn --cwd e2e test:meet-captions
```

`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` default to `Administrator`/`admin` locally.
`SFU_URL` is the health-check address; app connection metadata selects the SFU.
Each clip uses separate browser contexts, three seconds of startup settling and
a full 15-second collection tail after playback.

Default gates require zero failed clips/false-caption controls, speech WER ≤0.30
and correct attribution. Override with a JSON object, for example:

```sh
export MEET_CAPTION_THRESHOLDS='{"maxFailed":0,"maxWer":0.25,"minAttributionAccuracy":1,"maxFalseCaptionClips":0}'
```

Non-speech controls require `"expectSpeech": false` and `"reference": ""`, with
no speech annotations. Any meaningful interim or final caption fails the control;
no text succeeds only with verified browser audio publication. Controls do not
dilute speech WER, attribution or latency. For a controls-only run, omit speech
gates. `maxFalseCaptionClips`, `maxFalseInterimCaptionClips` and
`maxFalseFinalCaptionClips` require evidence for their respective observations.

## Diagnostics and paired scoring

Summary reports contain scores, source hashes and capture settings, without
transcripts or audio paths. Traces, screenshots and video are disabled.
`MEET_CAPTION_RAW_REPORT=/private/captions/raw.json` explicitly saves private
text, room/participant IDs and browser diagnostics with file mode `0600`. Use a
different path from the summary. `MEET_CAPTION_RUN_SETTINGS` accepts JSON labels
for inference settings; include no credentials. Labels do not verify a backend.

For room-scoped SFU captures, precreate rooms and set
`MEET_CAPTION_ROOMS_JSON_FILE` to a private JSON map of every clip ID to a unique
room ID. Configure the SFU diagnostic allowlist before starting it. Alternatively,
`MEET_CAPTION_ROOM_ID` works with one clip; the two overrides are mutually exclusive.

Compare direct endpoint predictions with the same corpus and Meet raw report:

```sh
node e2e/meet/captions/compare.mjs \
  --manifest /private/captions/manifest.json \
  --direct-predictions /private/captions/direct-predictions.json \
  --direct-inputs /private/captions/direct-inputs.json \
  --meet-raw /private/captions/raw.json \
  --output /private/captions/paired-report.json
```

Direct predictions are keyed by clip ID (the endpoint harness supports
`--save-predictions`). Direct input evidence needs
`audioInputs: [{id, sourceAudioSha256}]` from the replayed WAV bytes and
`operatorSettings` containing `modelImageDigest`, `modelRevision`, `language`,
`sampleRate` and `nameHints`. Record the same settings for Meet. Comparisons reject
changed inputs and report control observation coverage; unobserved metrics stay
null. Matching declarations still require independent checkpoint/session checks.

## Checks and limits

```sh
yarn --cwd e2e test:meet-captions-unit
yarn --cwd e2e test:meet-captions-smoke
```

These manual checks test scoring and real Chromium capture/observation without
Frappe or a GPU. They do not measure model quality.

Missing speech remains in error/failure denominators. Speech-relative latency
requires annotations; `finalAfterAudioSeconds` measures file end separately.
Browser timestamps are approximate, and DOM observation can miss short-lived
states or empty finals; inspect SFU events when completeness matters. Control
publication proves browser transmission, not SFU reception—check before-VAD PCM.
This evaluates one speaker after startup, not physical microphones, overlapping
speech, room load, reconnects or continuous-room background noise.
