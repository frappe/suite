# Meet transcription design

The initial brief was confirmed on 2026-10-19, revised after the bilingual-output interview, and narrowed to original-language transcription on 2026-10-21. This document records the current agreed design; the existing implementation and pilots have not established conformance or production acceptance.

The accepted behavior contracts are [capture](../../../specs/meet/001-recording-and-transcription-capture.md), [batch processing](../../../specs/meet/002-batch-transcription.md), and [artifact delivery](../../../specs/meet/003-capture-artifact-delivery.md). Pilot-dependent implementation gates are explicit in the processing spec.

## Settled boundaries

The owner deferred English translation on 2026-10-21 after the recognition and rendering pilots. V1 delivers one Original Transcript, preserving English, Hindi and code-switching. The accepted specs above are authoritative; the worker now integrates provisional Trelis recognition and Original Transcript.txt naming behind the disabled feature flag; shared automatic hints are implemented, while deployment acceptance remains open.

- Keep one capture flow with independent video/transcription toggles, one stop action and no dedicated processing-status view. Transcription does not require video. Existing host/co-host permissions, notices, four-hour limit, last-participant stop and E2EE exclusion continue to apply.
- Automatically handle English, Hindi and switching between them, including within sentences. No source-language selector is required.
- Deliver one Original Transcript in the languages spoken. Target Hindi in Devanagari and English words in Latin script, preserving participant attribution and capture-relative segment times. Add punctuation without translating, paraphrasing or changing substantive meaning.
- Preserve substantive points, corrections, disagreements, conditions, names and values. Mark detected uncertainty at its timestamp rather than filling it with plausible speech; do not promise detection of every error.
- Publish the usable complete or clearly partial transcript with one transcription notification. Video remains independently deliverable. After bounded retries, deliver usable source sections with omissions marked; if none are usable, send a transcription-failure notice without a file.
- Store new selected outputs under the owner's Meet / capture folder as Recording.mp4 and Original Transcript.txt. Leave existing artifacts and their names/locations in place. No pending placeholders or empty folders. English Transcript.txt is deferred.
- Keep the delivered transcript read-only and owner-controlled. Explicit sharing grants access. Trashing/permanent deletion remain independent from video, with recreation fences and shared metadata retained for surviving artifacts.
- Run recognition on infrastructure we control. Shared queue/worker capacity remains separate from live-caption inference and fairly scheduled across sites. Pin model/configuration and vocabulary versions for retries. Inference progress is not publication readiness; v1 has no English-rendering task or dependency.
- Reuse persistent recorder audio storage, preserving per-participant sources on a shared timeline. Video success cannot delete audio still needed by transcription. Delete temporary audio after final delivery; failed-job retention remains bounded at seven days. Delivered text is retained as an artifact.
- Share built-in, versioned product vocabulary across live captions and source recognition. Keep its version stable for an ongoing meeting/retries. Automatic participant-name and meeting-title hints remain meeting-scoped; participant hints update as people join.
- Do not add site-specific or host-entered manual glossaries, glossary-management UI, transcript-derived vocabulary learning or automatic searching of chats/email/documents.
- Retain the one-hour internal operating target and aggregate observability; no customer delivery guarantee, operational alerts or autoscaling are added.
- No recognition configuration is production-accepted. Trelis mixedcode is the leading candidate, with its signup-responsibility error and incomplete reference coverage still unresolved. Evaluate original-language fidelity, target scripts and English regressions before selection. The provisional 10% English recognition ceiling remains separate from script-aware mixed-language review.
- English translation, an English Transcript, summaries and action items are deferred. No translation queue, rendering retry or translation-failure notice belongs to v1. Translation research remains historical evidence and does not gate the original-language release.

## Existing infrastructure

- Live captions already use the SFU's per-producer audio ingestion, voice activity detection, and self-hosted speech-to-text service. See [the SFU README](../sfu-server/README.md).
- Caption processing starts with the first caption subscriber and stops when the last subscriber leaves. See [SttHandlers.ts](../sfu-server/src/server/handlers/SttHandlers.ts).
- Caption events include participant identity, text, final status, and approximate segment times. Times currently derive from recognition output arrival and duration. See [SttManager.ts](../sfu-server/src/stt/SttManager.ts).
- The frontend retains only a bounded, temporary caption history. Existing live caption delivery does not provide a durable Transcript.
- End-to-end encrypted rooms currently disallow live captions and recording.
- Meet already has a central Prometheus, Loki, and Grafana stack. See [observability](../observability/README.md).
- Recording Artifacts are saved in the Room Owner's Drive home under Meet Recordings and completion emails link directly to the artifact. Drive supports text files and existing sharing controls. Drive authorization can include administrative access and inherited folder grants, so private blob storage alone does not establish owner-only access.
- Existing video recording caps include four hours per Recording Session and at most one starting or active Recording Session per room. The transcription design adopts a four-hour maximum and one active Transcription Capture per room; exact per-site limits remain undecided.

## Model validation

Trelis remains provisional. The [current validation record](transcription-speech-hints-validation.json) records English and mixed-language replay results, failures and remaining quality/capacity gates. Translation is deferred; original-language source fidelity is still required before release. Do not apply the English normalizer to Hindi/mixed-script acceptance.

## Observability

Use the existing observability stack to expose the measurements below. Operational alerts and autoscaling are deferred:

- Queued jobs and queued audio duration, with incoming and completed audio duration per unit time. Duration should account for actual work across separate speaker tracks rather than only conversation length.
- Oldest queued-job age, queue wait distribution, processing duration, and capture-end-to-ready latency against the one-hour target.
- Active and healthy workers, worker resource utilization, completed audio duration per processing second, retry rates, failures, and jobs making no progress.
- Dashboard views that distinguish growing demand from unhealthy workers and expose risk of missing the delivery target.
- Aggregate metrics without participant names, transcript contents, or room identifiers as labels, following the existing observability conventions.

## Pilot-dependent implementation gates

- Validate original-language recognition against representative independently checked source wording, reviewed by listeners who understand the speech. Include Indian English, Hindi and switching within sentences, technical terms, names, values, noise and overlap. Check substantive meaning, questions, negation, corrections, omissions and invented speech; readability alone cannot pass.
- Retain normalized/strict English recognition WER diagnostics and the provisional 10% common-normalized ceiling. Mixed-language scoring needs a common script-aware reference/normalization policy. Freeze references and evaluation rules before measurement; uncertain spans remain unscored. No English-translation gate applies to v1.
- Measure sustained capacity, concurrent caption safety, queue fairness, source retention, recovery and transcript/video publication/deletion fences. Select hardware and limits from evidence, not warm-repeat timing or healthy HTTP probes alone.
- Validate the integrated original-language recognizer and shared automatic vocabulary hints before describing the implementation as production accepted. The current worker uses pinned provisional Trelis recognition and Original Transcript.txt naming, with quality/capacity gates still open. No production deployment is authorized by a successful draft alone.

## Recorder storage reuse

Reuse recording nodes' persistent source storage for v1. Extend the existing durable spool, restart recovery, and cleanup policy for access from shared transcription workers. Support audio-only captures without rendering or saving a video and preserve separate speaker audio. Storage placement does not require transcription inference to run on every recorder node.

The recorder already uses a persistent Docker volume at /data, with capture files under /data/captures and durable job records. This survives process/container restart but is not replicated host-loss protection. Current video cleanup deletes the whole capture directory only after Frappe authorizes cleanup; transcription reuse must extend that lifecycle so successful video delivery cannot remove audio still needed by transcription. Seven-day failed-audio retention and authenticated access from shared workers would be new behavior.

Ephemeral storage may cache reproducible weights and runtime files. Captured audio, durable jobs, and results remain on persistent storage. Cache loss must not lose pending work; workers must restore the pinned checkpoint or follow bounded failure/retry handling. The pilot host's instance-store cache is an operational convenience, not a required production mount path.

## Recording queue side discussion

The user separately asked whether recordings can be queued; no recording-queue change is approved scope. Current live recording requires immediate capacity and rejects starts when full. Recorder-side MP4 finalization starts at stop and is serialized per job, without a global finalization queue. Frappe-side validation/publication already runs on its long queue. Further queuing post-capture work is possible; queuing the start of live capture would miss speech before capacity becomes available.

## Deferred

English translation/rendering and a separate English Transcript are deferred without a committed release version. V1 does not create a rendering task or wait for an English artifact.

Selectable playback subtitles are deferred to v2. Preserve the relationship between video and Transcript outputs and their timing information in v1. Plain-text Transcripts cannot directly act as subtitle tracks: v2 needs timed cues mapped to the final video playback timeline, including omitted recording gaps, plus player support. Segment timestamps provide approximate placement; tighter synchronization requires additional alignment work.

## Drive organization

Use one Meet folder in the Room Owner's Drive, with a child folder named from the room title and capture start time for each capture. Put the selected outputs together there: Recording.mp4 and Original Transcript.txt as applicable. The transcript publishes after recognition and artifact delivery, independently of video; there is no translation dependency. Create the child folder only when its first usable output is ready; do not expose processing placeholders. Later outputs from that capture join the same folder. Leave existing Meet Recordings contents in place.

## Decisions

- [Use queued self-hosted batch transcription](adr/0013-queued-self-hosted-transcription.md).
- [Reuse recorder-node storage for transcription audio](adr/0014-reuse-recorder-storage-for-transcription.md).
