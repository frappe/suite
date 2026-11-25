# Reuse recorder-node storage for transcription audio

Retain temporary per-speaker transcription audio on recorder nodes' existing persistent storage, and let the shared transcription workers fetch it when ready. Reusing this infrastructure keeps v1 small but accepts delayed processing while a recorder is unavailable and loss of pending Transcripts if its disk is lost; replicated source storage is deferred. Extend cleanup coordination so video publication cannot delete audio still needed by transcription, deleting audio after the usable complete or partial Transcript is delivered, or after the seven-day failed-job retention window. Audio-only capture must not require rendering or saving a video.

Maintenance retries source deletion after the publication transaction commits. A recorder cleanup failure therefore cannot roll back a usable Transcript.

The site persists Stopping before retrying SFU audio cleanup so an unavailable SFU cannot delay stopping paired video. The recorder enforces retention locally even when the owning site is offline.
