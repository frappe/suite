# Shared Meet transcription worker

The worker integrates the provisional Trelis original-language recognizer for
English, Hindi and code-switching. It produces one Original Transcript; English
translation is deferred. Keep the site feature flag disabled until the
[deployment gates](../../../specs/meet/002-batch-transcription.md#deployment-gates)
are satisfied. Shared versioned vocabulary and automatic meeting hints are
implemented; integrating this candidate does not accept its quality.

A separately deployable worker serves multiple Suite sites. It polls the
sites' durable transcription jobs round-robin, uses atomically fenced leases, and
persists successful segment checkpoints through authenticated heartbeats. The
queue is logical shared work across site databases; a lost/restarted worker does
not own the only copy of any pending job. Each site enforces capture/admission
limits and maintains its own source retention and artifact lifecycle.

Capture and recognition do not depend on live captions. Recorder nodes retain
separate speaker PCM sources on persistent disk. The worker retrieves only
short-lived, source-scoped authorized URLs on explicitly configured recorder
origins, verifies sizes/hashes, resamples mono PCM16 24 kHz to the model's 16 kHz
input, and returns text on the original speaker/timestamp intervals. It does not
infer speakers or word alignment. True digital silence bypasses inference; VAD
on capture is still required for ordinary room silence/noise.

The Apache-2.0 `Trelis/whisper-hinglish-preview` checkpoint is pinned to revision
`eab1188fd2d0e91f2584229b32b3bfe1901c896c`, FP16 with SDPA. Each whole source
(at most30s of actual PCM) uses automatic language detection and the special
`<|mixedcode|>` token, original-language transcription, greedy decoding and no
previous-source context. Decoder exhaustion without EOS is a retryable source
failure rather than a successful truncated checkpoint. Pure digital silence
bypasses inference. Ordinary silence/noise still depends on capture VAD.

The canonical vocabulary is `suite/meet/speech-vocabulary.json`, consumed by both
caption and batch images through the dependency-free `speech_context.py` module.
Build either image from the Meet directory, using its respective Dockerfile.
Keep published version entries immutable and retained; advance `current` for a
new vocabulary. The first authenticated human join pins the room's vocabulary
version and title. New participants update automatic names within that room;
recorder manifests retain up to 100 distinct valid display names, including silent
participants. The final batch snapshot is persisted with the job and survives
retries without consulting a changed title or roster.

Caption inference uses the pinned vocabulary, title and up to 20 participant
names in per-utterance bias state. The Trelis adapter packs whole phrases into a
64-token prompt, prioritizing the current speaker and interleaving names, title
and product terms. It prepends that prompt before the normal language/mixedcode
prefix and reserves decoder space accordingly. These are recognition hints,
never output substitutions. Invalid/control/special-token labels are excluded;
there is no manual glossary or transcript-derived learning. No hint state is
shared across sites, meetings or source invocations.

The hinted decoding contract is `trelis-auto-mixedcode-greedy-hints-v1`.
Earlier unhinted Trelis jobs, like earlier Granite jobs, need their matching
worker; do not rewrite a stored configuration or reuse incompatible checkpoints.

The backend freezes the full supported model/decoding configuration for each new
capture. The worker rejects any different configuration before reading sources.
Existing Granite jobs/checkpoints are not rewritten or silently migrated: drain
those jobs with their matching earlier worker or resolve them explicitly before
switching a queue to this worker. An incompatible claim receives a terminal
`unsupported_model_configuration` callback. Operators must not change a job's
stored model to reuse its earlier checkpoints.

The [current validation record](../docs/transcription-speech-hints-validation.json)
records the bounded browser pilot and remaining production gates.

## Deployment

Use a GPU host with NVIDIA Container Toolkit, Docker/Compose, HTTPS connectivity
to the configured sites and recorder origins, and space for disposable model
weights. The image pins matching released Torch/TorchAudio 2.8.0 and Transformers
5.19.0. Worker code supports the base image's Python 3.11 independently of the
Frappe application's Python 3.14 requirement. The pilot's vendor Torch image is not this deployment image; validate the
built image on deployment hardware rather than assuming identical performance.

In `deploy`, copy `.env.example` to `.env`, create `secrets/sites.json` from
`sites.example.json`, and create a random `secrets/metrics-token`. Use a different
strong random worker secret for every site and set the same value as that site's
`transcription_worker_secret`. Configure the site's `transcription_enabled`,
existing SFU/recorder origin/secret settings, and source/admission limits as
documented in [backend configuration](../transcription/README.md).

Roll out compatible recorder and SFU services first, then migrate each Suite site
(`bench --site <site> migrate`) to install the capture fields and durable job
table. Configure secrets while leaving `transcription_enabled` disabled. Build
and smoke-test the worker image, verify authenticated queue access and metrics,
and complete the real-meeting acceptance gates before enabling the site flag.

The worker runs as UID 10001. Make the secrets private and readable by that UID;
keep them out of git. Create the cache directory owned by UID 10001 too. When
using ephemeral storage, check that the intended filesystem is actually mounted
before starting; a missing mount must not fill the host root filesystem. Only
reproducible model/runtime data belongs there. Captured audio, credentials,
durable jobs, and results remain on persistent storage.

Run `docker compose config` and `docker compose up -d --build`. The worker binds
to loopback port 8011; the optional proxy exposes only `/health` and bearer-
authenticated `/metrics` on a dedicated hostname. Integrate those paths into an
existing TLS proxy instead of running a second listener if ports 80/443 are
already occupied. No inference upload endpoint is exposed. Public checkpoint
downloads happen at startup; missing weights keep the worker unavailable until
it can restore the pinned model. No third-party inference service is used.

Use the same full site set on all replicas of one worker pool. Each worker
rotates sites after every claim, including failures, so a large site's backlog
cannot indefinitely exclude another site's work. Site row locks and opaque
300-second leases fence concurrent workers; 30-second heartbeats renew the lease
and source capabilities. A source request never follows redirects. Only the
configured site's worker secret goes to its queue endpoints; only the source
capability goes to the recorder. Frappe uses `X-Meet-Transcription-Authorization`
so its global OAuth bearer handler does not intercept this internal protocol.

A lost lease cannot acknowledge a result. Transient failure checkpoints completed
sources before bounded site-managed retries; resumed jobs skip those sources.
After retry exhaustion the site delivers a marked partial result when possible,
or sends a terminal failure email. SIGTERM stops new work and checkpoints the
active job for retry; durable source data is not stored in the worker container.

## Operations

Health is ready only when the model is loaded and authenticated queue access is
recent. Polling failure counters, queued job/audio counts, oldest queued age,
queue-observation freshness, active/healthy workers, GPU/RAM use, processed audio,
processing time, retries/failures and latency histograms are aggregate metrics.
No transcript, source URL, participant, room, capture or site identifier is a
metric label. Logs contain only enumerated operational events/reasons, without
request bodies, credentials or exception strings.

The [central observability stack](../observability/README.md) includes a
transcription dashboard and scrape template. Queue snapshots cover all sites in
the configured pool: do **not sum identical queue snapshots across replicas**;
the dashboard uses the maximum. Throughput counters include actual retry work,
while completed-job counts require acknowledged delivery. Short-clip model
benchmarks are not a worker-capacity guarantee. Operational alerts and autoscaling
remain deferred.

## Verification

From the repository root:

```sh
python3 -m unittest discover -s suite/meet/transcription-server/tests -v
```

These tests use the public worker interface, actual local HTTP protocol checks,
and injected recognition results; no GPU or model download is needed. They cover
source integrity/origin isolation, capability handling and redirect rejection,
lease fencing, silence, durable retry checkpoints, shutdown and fair scheduling.
Run the separate real-GPU smoke and cross-layer Frappe/recorder tests before
rollout. Test authorized representative Meet audio against independently checked
references and agreed quality thresholds; public AMI/Svarah results alone do not
close the production gates.

For a built-image smoke, place an authorized short audio clip at
`$FIXTURE_DIR/speech.flac` and its independently checked UTF-8 reference at
`$FIXTURE_DIR/reference.txt`. From `deploy`, run:

```sh
docker compose run --rm --no-deps \
  -v "$PWD/../tests:/app/tests:ro" -v "$FIXTURE_DIR:/fixtures:ro" \
  transcription python /app/tests/gpu_smoke.py \
  --audio /fixtures/speech.flac --reference-file /fixtures/reference.txt \
  --cache /models/huggingface
```

The smoke checks exact script-safe reference words and digital silence through the real
recognizer and worker processor; its queue is a local fixture, so it does not
claim production jobs. Use separate HTTP and Frappe tests for queue integration.

Also exercise actual service startup with its pinned model, an authenticated
local HTTP fixture queue, readiness, protected metrics, and graceful shutdown:

```sh
docker compose run --rm --no-deps -v "$PWD/../tests:/app/tests:ro" \
  transcription python /app/tests/gpu_service_smoke.py --cache /models/huggingface
```

## Shared-hint browser validation (2026-10-21)

The [aggregate record](../docs/transcription-speech-hints-validation.json) covers
159 passing focused checks (five skipped), including the caption adapter in its
native GPU runtime. Seven isolated browser scenarios exercised real WebRTC/SFU,
persistent capture, the queued hinted GPU worker and owner-private Drive delivery.
Six transcription jobs reached Ready; all nine artifact fetches allowed their
owner and denied anonymous access. Three videos contain valid audio/video streams.
Combined outputs share a folder, delivered source audio is cleaned up, and the
silence case has no invented speech. The mixed case retains the meeting title and
a silent late joiner's name without assigning that participant any speech.

The eight frozen English clips scored 1/100 normalized word errors (1%), including
1/52 Indian-English errors (1.92%); strict WER was 3/96 (3.125%). The two mixed clips
scored 8/49 script-safe word errors (16.33%), descriptive only. The English 10%
provisional gate passed, but this small replay does not accept meeting fidelity,
critical facts or production quality. No new manual owner transcription was needed.

Failed setup attempts and publication retries are retained in the record. The
isolated SFU needed its grant file bootstrapped and realtime needed the test site's
name/web port. Concurrent video reservations occupied the initial test Drive quota;
publication failed until adequate test headroom was provided, then normal retries
reused checkpoints. One early video-only stop HTTP failure remains unexplained;
the same browser flow subsequently passed without product changes. These findings
must not be presented as a flawless first run.

Production caption inference received health probes only. All monitored health
samples were good, worker free GPU memory stayed at least 8249 MiB, temporary
containers/services were removed, and the production image/start time and baseline
GPU memory were unchanged. Exact test-site configuration bytes and temporary DB
settings were restored. Keep the feature disabled pending the remaining gates.
