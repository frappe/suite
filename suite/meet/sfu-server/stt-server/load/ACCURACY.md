# Caption accuracy benchmark

Use `stt_accuracy.py` to replay manually transcribed clips against an **isolated**
STT replica, or score saved predictions without a GPU. This complements the
capacity harness: it measures recognition and script errors, not concurrent capacity.
It does not run through Meet's audio capture, VAD, transport, or caption UI.

For an initial public-data comparison, use
[Svarah](https://huggingface.co/datasets/ai4bharat/Svarah) for Indian English and
[MUCS Hindi–English test](https://www.openslr.org/104/) for switching. Svarah is
CC BY 4.0 and requires Hugging Face access approval; MUCS is CC BY-SA 4.0 and
offers direct downloads with audio, transcripts, and segment times. Preserve
the original references and check script conventions before scoring. A small
subset of these datasets tests accents and switching; it does not replace the
participant-name and negative-control recordings described below. Test `auto`
and `en-US` on identical clips, and optionally `hi-IN` on the switching subset.

## First dataset

Start with 40 short, consented recordings from multiple speakers:

- 20 Indian English clips: difficult participant names, natural conversation,
  quiet speech, short replies, and different microphones. English references
  should use Latin script, even when the speaker has an Indian accent.
- 10 English–Hindi switching clips: both switch directions and switches within
  sentences. Manually annotate English in Latin script and Hindi in Devanagari.
- 10 negative controls: ordinary speech with no participant names, but with
  plausible unspoken names in the roster. Include words resembling names.

Hold out speakers/clips from tuning; use a separate fixed evaluation set before
selecting a setting. Synthetic speech may test the harness but cannot validate
human accents. Use opaque clip IDs. Keep recordings, manifests, predictions, and
reports outside git. Obtain permission for benchmark use before recording or
reusing audio; do not take recordings from customer meetings.

Copy `accuracy-manifest.example.json` outside the repository. Its audio paths
and transcripts are illustrative; no recordings are bundled. Replace them with
actual recordings and manually checked text. Mark `consented: true` only after
obtaining permission. WAV files must be 24 kHz mono PCM16, nonempty, and at most
15 seconds. `audio` paths are relative to the manifest. Annotate
`speech_end_seconds` as the end of the **last spoken sound**, not the WAV duration.
Use the same audio and annotations in every comparison.

For publicly licensed datasets, document `dataset_license` and an HTTPS
`source_url` instead of asserting personal-recording consent. Retain source
licenses, attribution, original references, and selection provenance outside git.
The evaluator records your declared permission basis; it does not verify rights
or source-reference quality. Label unreviewed dataset references as preliminary.
If the last spoken sound has not been annotated, omit `speech_end_seconds` or
set it to null. The evaluator will report final delay after **audio end** and
leave speech-end delay unmeasured, rather than substituting a guessed boundary.

`language` is the per-clip prompt used unless overridden by `--language`.
`scenario` separates English-only and switching results. `names` is the room
roster (including unspoken names), limited to 20 entries. Names are matched as
exact normalized word phrases. To evaluate first-name mentions, include those
spoken first names explicitly. Longer names take precedence over overlapping
short names. Scoring does not forgive phonetic misspellings or perform text
replacement. New aliases must not be added to the reference after seeing errors.

## Experiments

Run from `suite/meet/sfu-server/stt-server`. Store the isolated replica's key in
`STT_API_KEY` without putting it in a command, report, or repository. Record the
image digest, model revision, GPU, and deployed context/silence settings in the
private experiment notes. `--image-digest` is included in the report.

```sh
uv run --no-project --with websockets==17.1 python load/stt_accuracy.py \
  --manifest /private/benchmark/manifest.json \
  --url http://isolated-stt:8000 --language auto \
  --label hints-auto --image-digest sha256:IMAGE_DIGEST \
  --output /private/benchmark/hints-auto.json

uv run --no-project --with websockets==17.1 python load/stt_accuracy.py \
  --manifest /private/benchmark/manifest.json \
  --url http://isolated-stt:8000 --language en-US \
  --label hints-en-US --image-digest sha256:IMAGE_DIGEST \
  --output /private/benchmark/hints-en-US.json
```

Repeat both with `--no-hints` to isolate the name-hint effect. Then compare the
previous image against the new one with the same prompt and audio. The old image
has no hint support, so use `--no-hints` for its runs. Name-weight tuning requires
a separately configured/built isolated replica; this tool does not change the
decoder weight. Repeat finalists to account for runtime noise.

English-only and switching results must be considered independently. An `en-US`
prompt fixing script errors on English-only clips does not prove that it preserves
Hindi during switching. Keep the mixed-language results even if neither setting
passes. Benchmarking is not an instruction to change the live language prompt.

### Same-checkpoint pipeline experiments

Keep the model revision and other settings fixed while comparing `auto`, `en-US`,
and `en-GB`. Nemotron's supported English prompts are US and British English;
`en-IN` is normalized to `en-US` by this service. The underlying model accepts
one trained language prompt at a time. This service's `languages` array selects
the first entry; it does not restrict automatic recognition to a bilingual pair.
See the [model's supported locales and streaming controls](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b).

Compare the current attention context with `[56,13]` in an isolated replica.
More acoustic lookahead may improve one group while worsening another; measure
English script alerts, switching WER, Hindi accepted-variant errors, and paced
streaming latency separately. A baseline that selects prompts using the dataset's
known language labels is an oracle comparison, not an automatic routing policy.
Any proposed selector must work without reading references or scenario labels.

Accelerated replay through `RealtimeTranscriptionSession` can screen accuracy
settings with the same 100 ms PCM chunks, resampling, and final silence. First
verify that its current-setting transcripts match saved paced WebSocket results.
Record disagreements and fallback use. Compute duration and the amount of audio
needed for first text are diagnostics, not live caption latency. Replay promising
settings with the paced WebSocket harness before making latency or release claims.

Raw sentence language tags can be retained privately for diagnosis before
`clean_transcript` removes them. Tags may be absent on short or incomplete clips,
and a tag for an earlier sentence does not label a later phrase. Neither tags nor
the presence of Devanagari alone justify routing or replacing a transcript.
English-labelled public data can include Hindi written in Latin script: review
these cases by listening and preserve the original reference and review history.
Do not rewrite references to fit a model's output. Prompt changes while audio is
buffered are rejected; alternate-prompt experiments require a fresh decode.

## Metrics and review

- **WER:** aggregate word edits / reference words, after Unicode normalization,
  case folding, and punctuation removal. Combining marks are preserved for Hindi.
  Failed clips remain in the denominator; empty outputs count as deletions.
  WER may exceed 1. Silence-only groups have undefined WER; their inserted words
  remain visible in `word_errors`.
- **Names:** exact expected and recovered mention counts, recall, missed mentions,
  and extra roster-name mentions. Wrong names outside the roster contribute to
  WER, but cannot be identified as names automatically. Mention counts do not
  verify order, attribution, or the correct person in context; review errors.
- **Script:** Devanagari letters in outputs whose references contain none are
  counted separately. This detects the English-only failure described above;
  it does not establish correct switching or Hindi quality. Mixed-script
  references are exempt from this particular alert and still scored for WER.
- **Delay:** first interim text from playback start; final text from annotated
  speech end. Trailing WAV silence contributes to final delay. Deltas emitted
  after commit acknowledgement do not count as interim text. Percentiles include
  only successful clips with measured timing; inspect sample counts and failures.
  `final_after_audio_seconds` is also reported and must not be presented as
  speech-end delay when annotations are missing.
- **Sender lag:** high lag means the replay client missed its audio clock, so
  latency results need to be rerun on an unsaturated client.

Reports include per-clip counts and summaries by accent, language, and scenario.
They omit audio paths, references, name hints, and predicted transcripts. Avoid
personal names in clip IDs and experiment labels. Files are written with mode
0600. Optionally use `--save-predictions /private/benchmark/predictions.json` for
private human review and repeatable offline scoring. This file **contains text**.

Offline predictions are a JSON object keyed by every manifest clip ID:

```json
{
  "english-001": {
    "transcript": "Siobhan, please send the report to Aarav.",
    "failed": false,
    "first_text_seconds": 0.8,
    "final_after_speech_seconds": 0.9
  }
}
```

Missing or extra IDs are rejected. For a failed clip, provide an empty transcript
and `failed: true`; do not omit the clip. Offline timing is optional and must come
from measurements, not estimates.

```sh
uv run --no-project --with websockets==17.1 python load/stt_accuracy.py \
  --manifest /private/benchmark/manifest.json \
  --predictions /private/benchmark/predictions.json \
  --label offline-review --output /private/benchmark/offline-report.json
```

Exit status is nonzero for incomplete speech clips or protocol failures, while
recognition/script errors are reported as measurements. Proposed release goals
are 20% fewer name errors without extra wrong-name insertions, no Devanagari
output on the English-only holdout set, and p95 final delay below 2 seconds.
These are evaluation targets, not results. Validate gains through Meet staging
and under overlapping-speaker load before changing live settings.

## Local verification

```sh
uv run --no-project --with websockets==17.1 \
  python -m unittest discover -s load -p '*_test.py'
```

The model-free tests use independently specified references and a local fake
Realtime server. The existing harness CI discovers both load and accuracy tests;
no GPU, real recordings, or live endpoint is used by CI.

## Monsoon and accepted Hindi variants

[Monsoon Indian English](https://huggingface.co/datasets/VoiceArena/MonsoonASR-Open-ASR-leaderboard-en-IN)
and [Monsoon Hindi](https://huggingface.co/datasets/VoiceArena/MonsoonASR-Open-ASR-leaderboard-hi-IN)
provide CC BY 4.0 spontaneous conversational speech with speaker and regional
metadata. Select distinct speakers across regions before inspecting model output,
and pin dataset revisions. Hindi includes publisher-reviewed accepted spelling
and transliteration variants. Preserve these as `reference_lattice`, an array of
nonempty arrays of phrase variants, with `oiwer_language: "hindi"`. Keep `reference`
as the publisher's first variant per slot for a separate, convention-sensitive WER.
Do not generate or expand variants using the evaluated predictions.

For lattice manifests, add `--with voi-oiwer==0.1.4` to the commands above. The
optional official scorer reports aggregate `oiwer`: summed insertion, deletion
and substitution counts divided by its aligned reference-word count. Only clips
with a lattice contribute; its `clips` count identifies coverage. Strict WER and
English Devanagari checks continue independently. Do not compare a subset's OIWER
with the leaderboard's full-set WER or interpret accepted Hindi transliterations
as proof that English script selection is correct. MUCS has no publisher lattice,
so its ordinary WER remains unchanged.

Run the optional metric's behavioral tests with:

```sh
uv run --no-project --python 3.12 --with websockets==17.1 --with voi-oiwer==0.1.4 \
  python -m unittest discover -s load -p '*_test.py'
```
