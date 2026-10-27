# Batch transcription processing

Status: accepted; original-language-only v1 confirmed 2026-10-21, implementation and model validation pending

Scope: The v1 processing, temporary source storage, isolation, and operational behavior after [transcription capture](001-recording-and-transcription-capture.md). Model quality and capacity are subject to the explicit pilot gates below.

Use the terms in [Meet context](../../suite/meet/CONTEXT.md). Architectural decisions are recorded in [queued self-hosted transcription](../../suite/meet/docs/adr/0013-queued-self-hosted-transcription.md) and [recorder storage reuse](../../suite/meet/docs/adr/0014-reuse-recorder-storage-for-transcription.md). Result delivery follows [the artifact contract](003-capture-artifact-delivery.md).

## Processing contract

- Save speech during capture and queue it for batch transcription afterward. Finalized live-caption output is not the authoritative Transcript.
- Run recognition entirely on infrastructure we control. Do not send meeting audio or text to third-party inference services.
- Use one shared multi-site queue and worker pool. Inference capacity is separate from live-caption inference and does not require a model deployment per site or recorder node.
- Keep recognition replaceable independently of capture and artifact storage. Pin the model identifier, checkpoint revision, precision, preprocessing/decoding configuration and built-in vocabulary version; retries must not silently switch them. V1 has no English-rendering stage. Model selection remains subject to the original-language pilot gates.
- Preserve speaker attribution using participant identity associated with captured audio rather than requiring the model to infer speaker identity from a mixed recording.
- Produce speech-segment timestamps on the capture timeline. Word-level alignment is outside v1.
- Target delivery within one hour after capture ends. This is an internal operating target, not a customer-facing completion guarantee or an established service-level percentile.
- Video finalization or delivery does not wait for transcription. A usable Transcript may be delivered even if its paired video fails.

## Original-language output

- Produce one Original Transcript for English, Hindi and mixed Hindi–English speech, preserving the languages spoken, source speaker attribution and capture timeline. English-only speech remains English; Hindi speech is not translated.
- The Original Transcript is a readable account of the original speech, not a dump of model tokens. Target Hindi in Devanagari and English words in Latin script, with punctuation but no translation or meaning rewrite.
- Preserve substantive points, qualifications, disagreements, corrections, conditions, names and critical values in the original speech. Do not paraphrase, summarize or extract action items. English translation and a separate English Transcript are deferred.
- Mark detected uncertain passages with their timestamps; do not silently infer a plausible name, number or sentence. Unsupported/unintelligible speech must remain identifiable. This does not promise detection of every recognition error.
- Recognition checkpoints are internal processing progress. A job becomes ready only after its usable complete or explicitly partial Original Transcript is published; model inference alone must not trigger final source cleanup.
- Publish the Original Transcript with one transcription completion notification, as specified in the artifact contract. Do not wait for translation or create an English artifact, rendering job, or translation-failure notice in v1.

## Shared vocabulary and automatic hints

- Reuse one built-in, versioned product/domain vocabulary across live captions and original-language recognition. Models may consume hints differently; sharing vocabulary does not require sharing inference deployments.
- Add automatic meeting hints from participant display names and the meeting title. Participant hints update as people join and remain scoped to the authenticated site and meeting.
- Keep the built-in vocabulary version stable for an ongoing meeting and its processing retries. Vocabulary updates apply to subsequent meetings; dynamic participant hints are separate.
- Do not add a site-specific manual glossary, host-entered vocabulary, glossary-management UI, automatic learning from generated transcripts, or searching chats/email/documents for hints.
- Hints guide recognition/spelling; they do not establish that a word was spoken and must not be applied as unconditional text replacements. Live translation remains outside v1.

## Scheduling and resource bounds

- Schedule fairly between sites so one site's submitted work cannot indefinitely prevent other sites from making progress.
- Make per-site capture concurrency and queued-audio limits operator-configurable. Enforce the four-hour per-capture maximum and one-active-Transcription-Capture-per-room contract independently of those settings.
- Reject new captures visibly when applicable admission limits are reached.
- Bound temporary audio storage independently of processing capacity. Do not admit capture beyond the configured source-storage allowance.
- Measure work across separate speaker sources; conversation wall-clock length alone is not an adequate measure of queued audio work.
- Preserve queued work across process restarts. Source data durability remains subject to the recorder-node storage limitation below.

## Temporary source storage

- Reuse recorder nodes' persistent storage for temporary per-speaker audio. Shared workers retrieve authorized source audio when ready to process it.
- Retained source audio survives process/container restarts; v1 does not promise replicated storage or survival of recorder disk loss.
- Recorder unavailability may delay processing. Losing the recorder disk may lose pending Transcripts; do not report missing source audio as successful transcription.
- Coordinate cleanup across selected outputs: completing or publishing video must not delete audio still needed by transcription.
- Delete source audio after the final transcription outcome has been delivered, including a declared partial outcome. Successful recognition alone is not final completion. Failed-job audio may remain for retries for up to seven days, after which it must be deleted. Retention of the delivered Original Transcript is normal artifact retention, not temporary source-audio retention.
- Ephemeral storage may cache reproducible model weights and runtime/download files. Keep captured source audio, durable queue/job records, and generated results on persistent storage; losing a model cache must not lose pending work. A worker with missing weights must restore its pinned checkpoint before processing or fail through the bounded retry contract.
- Keep source audio as internal processing input. Do not expose it as an owner-playable or downloadable audio artifact.
- Apply independent per-artifact deletion fences and coordinate remaining audio cleanup with active output dependencies, as defined by the artifact contract. Deleting the delivered transcript must not remove its paired video, and video deletion must not remove the transcript.

## Failures and retries

- Automatically retry transient processing failures up to three times, with increasing delays. Retries are bounded rather than an infinite processing loop.
- When retries are exhausted or processing fails permanently, email the Room Owner. There is no user-facing retry button in v1.
- Operators may retry retained audio within its seven-day retention window while investigating failures.
- Preserve successful original-language sections when part of recognition fails. After bounded retries, deliver one clearly marked partial Original Transcript if usable speech remains. If recognition produces no usable result, report failure without a transcript or placeholder file. Translation is not a prerequisite or a failure state for v1.
- Known missing capture intervals must remain identifiable. Partial recovery must not imply that uncaptured speech was transcribed. If a restart loses per-speaker progress, conservatively mark the interval in which speech may be missing, preserve recovered text within it, and label the uncertainty rather than claiming the entire interval is absent.
- Worker retries and restart recovery must not produce duplicate Original Transcript artifacts. Fence publication and deletion independently from video while preserving their shared capture identity.

## Isolation

- Authenticate worker access to source audio and result delivery. Restrict each operation to its authorized site and capture.
- Isolate sites' jobs, source audio, and results even though workers and queue capacity are shared.
- Knowledge of another site's room, job, capture, or file identifier must not grant access to its audio or Transcript.
- Do not collect meeting speech, transcript content, or credentials in operational logs or metrics. Follow the existing [observability conventions](../../suite/meet/observability/README.md).

## Observability

Extend the existing Prometheus/Grafana infrastructure to expose:

- Queued job count and queued audio duration; incoming and completed audio duration per unit time.
- Oldest queued-job age, queue-wait distribution, processing duration, and capture-end-to-ready latency.
- Active and healthy workers, worker resource utilization, and completed audio duration per processing second.
- Retry and failure rates, and jobs making no progress; distinguish recognition stalls/failures from publication stalls/failures without exposing source text.

Dashboards must let an operator distinguish growing demand from unhealthy or stalled workers and assess risk to the one-hour target. Metrics must be aggregate; participant names, Transcript content, and room identifiers are not metric labels. Operational alerts and autoscaling are deferred.

## Acceptance scenarios

1. Two sites submit work while one has a large backlog. Both sites make progress under fair scheduling; neither can fetch the other's audio or publish into the other's Drive.
2. A worker restarts while a job is pending or processing. Recoverable work resumes without producing duplicate Transcript artifacts.
3. Video publishes while transcription is still queued. Its source audio remains available, and video delivery is not delayed by transcription.
4. A transient failure receives at most three automatic retries with increasing delays. Exhaustion produces an owner email and no placeholder file for an unusable transcript.
5. Some recognition sections fail while others succeed. One partial Original Transcript identifies omissions and preserves successful text; zero usable speech produces failure without a transcript file.
6. A recorder is temporarily unreachable. Its jobs remain distinguishable from healthy processing; missing audio is not reported as a completed result.
7. Source audio is removed after complete or partial transcript delivery, or at the failed-job retention deadline. Operators cannot retry audio after it has expired.
8. Increasing queued audio, an aging oldest job, and a stalled worker are distinguishable using operational dashboards without exposing meeting content.
9. A worker loses its disposable model cache. Captured audio and durable jobs remain available; processing waits for the pinned model or follows bounded failure/retry behavior without creating a false successful result.
10. Recognition checkpoints survive a worker restart. Publication recovery produces one Original Transcript without redoing successful sources or deleting audio before delivery.
11. English and Hindi alternate within a sentence. One Original Transcript preserves the spoken languages, substantive meaning and target script policy. No language selector, translated artifact or rendering task is required.
12. A built-in vocabulary update occurs during a meeting. The active meeting/retries keep their version; new participant hints still update within that room. No site or host manual glossary is offered.

## Pilot candidates and evidence

- The earlier Granite candidate and public English pilots remain evidence for English recognition efficiency only. Granite TurboCTC is English-only; Cohere Transcribe does not list Hindi support. Neither is selected for the revised mixed-language requirement.
- Trelis Whisper Hinglish Preview in automatically detected mixedcode mode is the leading source-recognition candidate. Its checked signup-responsibility error and incomplete source references remain unresolved. See [the current validation record](../../suite/meet/docs/transcription-speech-hints-validation.json).
- No recognition configuration is production-accepted. Pin and evaluate source-script handling, substantive fidelity and English regressions before selection. The earlier translation failures support deferral; translation quality no longer gates v1.
- See [the current validation record](../../suite/meet/docs/transcription-speech-hints-validation.json). Readable drafts and public short-clip scores do not establish source fidelity, code-switching quality or sustained capacity.

## Deployment gates

- Evaluate representative authorized English, Hindi and mixed Hindi–English Meet audio against independently checked original-language references, reviewed by listeners who understand the speech. Include Indian-accented English, switching within sentences, longer recordings, names/domain terminology, overlapping speech, silence/noise and degraded audio.
- Keep normalized and strict WER as diagnostics for English recognition; retain the provisional 10% common-normalized English recognition ceiling and report Indian English separately. Freeze references, selection and normalization before measurement and apply them identically to candidates.
- Do not apply an English-only normalizer or the 10% English recognition ceiling to Hindi or mixed-script text. Establish a common script-aware reference/normalization policy before reporting mixed-language numerical recognition scores.
- Gate the Original Transcript through source-language listening review: it must be understandable and preserve substantive meaning, with no critical errors in the checked pilot samples. Review names, dates, amounts, identifiers, commitments, conditions, negations, corrections, omissions and invented speech. Report smaller errors separately. Passing a finite pilot does not guarantee error-free production output.
- Do not use fluency, another model's output or agreement between models as ground truth. Formatting must not conceal uncertain or missing recognition. Translation, summaries and action items remain outside v1.
- Measure sustained end-to-end throughput, backlog behavior, recovery, and cleanup using separate speaker tracks. Select worker hardware, capacity, and per-site operational limits from those measurements. Validate isolation from live-caption inference under concurrent speech load; healthy HTTP probes alone do not establish latency safety.
- Validate authenticated audio retrieval, source cleanup coordination, site isolation, and cache-loss recovery before deployment. Hardware sizing, per-site limits, a service-level percentile, and final production quality acceptance remain open.

Changing live-video recording to use a new global finalization queue was a separate discussion and is outside this feature's scope.
