# STT capacity measurement

For recognition, participant-name, and English/Hindi script evaluation, see
[the accuracy benchmark](ACCURACY.md). Its evaluator supports paced replay and
offline scoring against manually checked references.

Run against an **isolated** STT replica with the production image, model, GPU,
and configuration. Do not use the live service. The script sends 24 kHz mono
PCM16 WAV audio over the public authenticated Realtime WebSocket. Each stream
models **one simultaneously speaking producer**, not one meeting; a meeting
with three overlapping speakers can use three streams. Reuse a representative
clip containing speech and natural pauses (up to 15 seconds) that produces a
nonempty final transcript at baseline. Empty finals count as failures. Do not
include customer audio or credentials in the resulting report.
Packets default to 100 ms, matching the SFU's VAD output; use `--frame-ms 20`
only to compare a higher-frequency client.

```sh
export STT_API_KEY='key-for-the-isolated-replica'
uv run --no-project --with websockets python load/stt_load.py \
  --url http://isolated-stt:8000 --audio /path/to/speech-24k-mono-pcm16.wav \
  --streams 1 --rounds 24 --gap 1 --output /path/to/report-1.json
```

Use `--urls http://replica-1:8000,http://replica-2:8000` to assign streams
round-robin across isolated replicas. Streams wait until every connection is
ready before starting; `--stagger-ms 150` offsets their audio clocks. Use
`--languages en-US,es-ES` and `--trim-ms-step 40` to exercise differing
languages and final packet lengths. To measure the current biased decoder,
`--names Siobhan,Zubair` sends one *synthetic* room-name hint per stream,
cycling through the supplied names; compare with a run without hints.
The report contains only the number of hints per stream, not the names or
transcripts. Compare completion rates and latency across runs instead of
retaining transcript text or hashes. Do not supply private participant names
or speech.

Repeat for 2, 4, 8, ... streams, then near the observed knee with smaller
increments. Repeat each level several times with the same audio and GPU state;
include a load level above the knee. Use enough rounds to detect a late-run
backlog. Compare first-text and final-after-audio p50/p95/p99, failures,
late-versus-early p95, and sender lag. The sender follows the *audio clock*,
not the model's responses, so a server that falls behind cannot hide it by
slowing the test. If sender lag rises, the load generator is saturated and the
run is invalid; move it off the GPU host or reduce competing activity. A
completed nonempty final can lack an interim caption; those cases are excluded
from first-text percentiles, so inspect that count as well. Only text observed
before the server acknowledges a round's commit counts as interim; final deltas
after the acknowledgement do not.
Without `--languages`, the harness uses the model and language advertised by
each isolated replica's Realtime session; configure replicas as you would
production.

Agree on an SLO first (for example, p95 final within 2 seconds of the last
audio frame, no failed utterances or increasing late-run lag). Capacity is the
highest sustained level meeting that SLO, **not** the highest socket count.
Record GPU utilization/memory and process CPU/RSS alongside each run; capture
the image digest, model revision, GPU type, clip provenance, and command. Keep
the raw JSON reports outside the repo.

This measures the model service only. In a separate Meet staging exercise,
create the same number of rooms with real audio producers and caption viewers,
then measure browser-visible first/final caption delay, lost captions, SFU
CPU/RSS, FFmpeg process count, and reconnects. Include both one active speaker
per room and overlapping speakers; idle producers still cost an FFmpeg process
and WebSocket. The gap between this result and the service-only result captures
SFU/transport/UI overhead. This second stage requires a staging Meet deployment
and is not automated by this STT-only harness. These measurements are opt-in
GPU/staging tests, not PR CI tests.

The harness itself has a model-free local test, also run in PR CI for load-only
changes without building the production STT image:

```sh
uv run --no-project --with websockets python -m unittest discover -s load -p '*_test.py'
```
