# Meet transcription backend

This package connects the existing capture controls to recorder source storage, a durable per-site Frappe queue, and owner-private Drive publication. One shared worker pool consumes these per-site partitions using fair round-robin scheduling; sites never share credentials or database rows. See the [shared worker](../transcription-server/README.md) for runtime, model, deployment, and dashboard configuration.

New captures pin the Trelis recognizer and deliver one
`Original Transcript.txt`, preserving English, Hindi and code-switching without
translation. Existing delivered artifacts retain their filenames and identities.
Shared versioned vocabulary and automatic meeting hints guide recognition.
Configure the shared worker and enable `transcription_enabled` for each site.

## Site configuration

Keep secrets in protected site configuration. Never expose them in browser responses or logs.

| Setting | Meaning / default |
| --- | --- |
| `transcription_enabled` | Opt-in feature gate; disabled by default. The existing Meet recording setting gates the shared capture action. |
| `transcription_worker_secret` | Unique per-site random secret, at least 32 characters. Configure the same secret in that site's shared-worker entry. |
| `recorder_server_url` | HTTPS recorder origin, with no path/query/redirect. Loopback HTTP is supported for development. Reuses `recorder_secret`. |
| `sfu_server_url` | HTTPS SFU origin, with no path/query/redirect. Reuses `sfu_secret`. |
| `recorder_site_origin` | Public site origin bound into recorder and SFU capabilities. Defaults to the site's configured URL. |
| `transcription_max_concurrent` | Simultaneously capturing source intervals per site; default 2. |
| `transcription_max_queued_audio_seconds` | Admission ceiling for queued plus processing speaker-audio seconds; default 86,400. |
| `transcription_capture_max_bytes` | Reserved persistent-source allowance per capture; default 2 GiB. PCM16 mono 24 kHz uses 48,000 bytes per speaker second. |
| `transcription_max_source_bytes` | Site-wide retained/reserved source allowance; default 10 GiB. |

Defaults bound resource use; tune them for the available storage and processing capacity. Set recorder-wide storage/concurrency limits independently. The SFU must allowlist the recorder origin using `TRANSCRIPTION_RECORDER_ORIGIN`.

## Worker protocol

POST JSON to `/api/method/suite.meet.api.transcription.<operation>` using `X-Meet-Transcription-Authorization: Bearer <site-secret>`. This deliberately follows the recorder's custom-header pattern: Frappe reserves ordinary `Authorization: Bearer` for OAuth. No user session or CSRF cookie is needed. Frappe wraps responses in `message`.

- `claim {worker_id}` atomically grants a 300-second lease, or returns `job: null`. Claims include the immutable model identifier/revision/precision/configuration, captured source manifest, durable completed segments, and queue metrics.
- `heartbeat {job, worker_id, lease_token, segments?, processed_source_ids?}` extends the lease and refreshes 120-second, site/capture/source-bound audio capabilities. Send heartbeats every 30 seconds. Completed segments checkpoint progress across retries, including empty text for successfully processed silence.
- `complete {job, worker_id, lease_token, segments, processed_source_ids, gaps?, partial?}` validates attribution and capture-relative timing, publishes once, and schedules source cleanup and an owner email. Empty successfully processed sources establish silence; missing sources become marked omissions.
- `fail {job, worker_id, lease_token, code, transient, segments?, processed_source_ids?}` checkpoints progress and retries transient failures after 60, 300, and 1,800 seconds. A fourth failure is terminal; retained successful segments produce a partial transcript.
- `queue_status {}` returns aggregate queue gauges without participant content. Incoming/completed audio rates use a fixed trailing 300-second window based on first enqueue and publication times. `stalled_jobs` counts expired processing leases. Deletion removes associated observations, so these are windowed gauges, not lifetime counters.

Worker result source IDs, speaker IDs/names, and segment boundaries must match the frozen source manifest. Source audio is PCM16 little-endian mono at 24 kHz; Trelis preprocessing resamples to 16 kHz. Each segment is at most 30 seconds, with at most 10,000 segments per capture. Worker authentication is independent of Room Owner permissions; knowledge of an identifier grants no access.

The minute scheduler reconciles retained capture manifests, SFU restarts, abandoned leases, bounded retries, source deletion, and owner notifications. Operators may call `operator_retry` as a System Manager only while failed source audio remains within its seven-day retention window. Retrying never changes the pinned model configuration.

## Storage and deletion

Source audio remains on the recorder's existing persistent volume. Reproducible model caches may use ephemeral GPU storage; queue rows, speech results, and captured sources may not. Completed results use deterministic publication and capture-folder identities, private Drive permission boundaries, and normal Drive trash/restore. Permanent deletion revokes leases and clears speech metadata before source purge; stale completions cannot recreate a transcript. Video and transcription source cleanup remain independent.

Generated text cannot be overwritten through File REST updates or WebDAV. Owners may rename, move, share, trash, restore, permanently delete, or download a copy. Existing `Meet Recordings` artifacts retain their original locations; captures using the new contract use `Meet/<room + start + capture identity>/Recording.mp4` and/or `Original Transcript.txt`.

## Verification

Run standalone validation with `python3 -m unittest suite.meet.transcription.test_protocol`. Run Frappe integration tests from a configured bench test site with `bench --site <test-site> run-tests --app suite --module suite.meet.api.test.test_transcription`; existing recording API tests remain regression coverage. These tests verify publication, private access, retry and cleanup behavior using supplied recognition results; model accuracy is tested separately.
