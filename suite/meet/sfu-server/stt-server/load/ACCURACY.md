# Caption accuracy benchmark

`stt_accuracy.py` measures recognition accuracy against an isolated STT replica,
or scores saved predictions offline. It sends audio directly to STT; use the
[Meet caption harness](../../../../../e2e/meet/captions/README.md) to test VAD,
transport and rendered captions.

## Corpus

Copy `accuracy-manifest.example.json` outside git and replace its examples with
real audio and references. Audio must be nonempty 24 kHz mono PCM16 WAV, at most
15 seconds; paths are relative to the manifest. Use consented recordings or
provide `dataset_license` and `source_url`. Keep audio and private results outside git.

- `reference`: expected text; for mixed speech, use English in Latin script and
  Hindi in Devanagari. Keep references fixed across runs.
- `language`: per-clip prompt, overridden by `--language` when supplied.
- `names`: roster hints, up to 20 names. Compare with `--no-hints` to measure their effect.
- `speech_end_seconds`: optional annotated end of speech. Without it, only
  final delay after the audio file ends is measured.
- `accent` and `scenario`: labels for grouped results.

## Replay

Run from `suite/meet/sfu-server/stt-server`. Create the output directory first
and load the isolated replica's key into `STT_API_KEY`.

```sh
uv run --no-project --with websockets==17.1 python load/stt_accuracy.py \
  --manifest /private/benchmark/manifest.json \
  --url http://isolated-stt:8000 --language auto \
  --label baseline --image-digest sha256:IMAGE_DIGEST \
  --output /private/benchmark/report.json \
  --save-predictions /private/benchmark/predictions.json
```

Compare the same audio, references, model and configuration between runs.
Evaluate English-only and switching clips separately when comparing `auto`
with `en-US`. Record the actual model revision, attention context and final
padding alongside the report; an image label alone does not establish parity.

## Offline scoring

Predictions are an object keyed by every manifest clip ID:

```json
{
  "english-001": { "transcript": "Send the report to Aarav.", "failed": false }
}
```

Use an empty transcript with `failed: true` for a failed clip. Missing or extra
IDs are rejected.

```sh
uv run --no-project --with websockets==17.1 python load/stt_accuracy.py \
  --manifest /private/benchmark/manifest.json \
  --predictions /private/benchmark/predictions.json \
  --label offline --output /private/benchmark/offline-report.json
```

## Results

Reports include WER, roster-name recall and extra mentions, English Devanagari
alerts, measured latency, and sender lag. WER ignores case and punctuation but
preserves Hindi combining marks; empty outputs count as deletions. Timing
percentiles include only successful clips with measurements, so check coverage.
High sender lag invalidates latency comparisons. Recognition errors are reported
as measurements; incomplete speech or protocol failures cause a nonzero exit.

Reports omit raw text; `--save-predictions` contains transcripts. Both are written
with mode `0600`.

For publisher-supplied Hindi variants, provide `reference_lattice` and
`oiwer_language: "hindi"`, and add `--with voi-oiwer==0.1.4` to the commands.
Accepted-variant scores are separate from strict WER and cover only those clips.
