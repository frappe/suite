# Manual transcription pilot

This opt-in Playwright workflow exercises microphone publication, SFU capture, persistent recorder storage, and the normal recording/transcription controls. It is separate from the regular Meet test suite. Use an isolated test site with the test host provisioned, recording/transcription enabled, working native SFU and recorder services, and the pinned GPU worker connected to that site's authenticated queue.

Use authorized speech only. Freeze clip selection, references, hashes, and the normalization policy before running. Keep the manifest, browser report, raw results, and downloads outside git in a private directory. Traces, screenshots, and browser videos are disabled because they can contain meeting content. A fake camera is used; microphone audio comes from the WAV fixtures and crosses real WebRTC transport.

The current product contract delivers one Original Transcript, with English
translation deferred. The fixed English corpus evaluates English speech and infrastructure. An optional
two-clip `hinglish` cohort adds a mixed-language capture with a silent late joiner
and a meeting title, checking the persisted automatic hint
snapshot. Neither establishes complete model acceptance. New results must be checked for `Original Transcript.txt` naming. Never apply its English normalizer or numeric gate to
Hindi/mixed-script references.

The private manifest has a `cases` array. Each clip needs `id`, `path` (relative to the manifest), `reference`, `sha256`, `corpus`, and `license`. Supply four `ami` and four `indian-english` clips, plus a six-second `silence.wav` beside the manifest. These corpus labels describe this fixed pilot protocol. The runner verifies the original fixture hashes before playback.

```sh
BASE_URL=http://localhost:8098 \
MEET_TRANSCRIPTION_MANIFEST=/private/pilot/fixtures/manifest.json \
MEET_TRANSCRIPTION_CAPTURE_REPORT=/private/pilot/captures.json \
MEET_TRANSCRIPTION_OUTPUT=/private/pilot/browser-results \
yarn --cwd e2e playwright test -c meet/transcription/pilot.config.ts
```

Set `MEET_PILOT_CHROMIUM` only when a custom Chromium executable is needed. `MEET_PILOT_START` and `MEET_PILOT_CASES` select the start and exclusive end scenario indices for a documented infrastructure retry; a nonzero start requires the earlier private report. Retain failed-attempt evidence and never replace a quality failure with a selected better run.

Initialize the isolated SFU recording-grant persistence file through its bootstrap
operation before starting the server; a missing file correctly fails closed.

The six base scenarios are transcription-only, combined capture, another transcription capture, combined capture with overlapping speakers, video-only, and silence. The browser report records captures after the stop request succeeds; it does **not** establish asynchronous delivery or model acceptance. Separately wait for terminal jobs, verify private owner access and anonymous denial, check both outputs share the expected private folder, inspect video validity and gaps, confirm source cleanup, and verify notifications through a configured test mail sink. Monitor queue growth and worker resources during the run. Stop the pilot on production health failure or insufficient resource headroom, and restore temporary services and settings afterward.

For recognition, concatenate completed segments chronologically per known participant and compare each with its frozen reference. Use the same Whisper `EnglishTextNormalizer` and spelling dictionary as the prior comparisons (dictionary SHA-256 `bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd`). Sum word-edit errors and reference words across clips, then divide; do not average clip percentages. Report strict WER as well, using case-folding and punctuation removal except apostrophes. Retain raw predictions privately.

The provisional gate is **at most 10% aggregate normalized WER**. Report Indian English separately. Independently review names/numbers, missing speech, speaker attribution, and silence, including coverage gaps. Passing a small replay corpus does not establish production acceptance, sustained capacity, or live-caption latency safety.

The [2026-10-20 aggregate results](../../../suite/meet/docs/transcription-meet-pilot-results.json) record the initial run, its partial-video result, and remaining deployment gates.
