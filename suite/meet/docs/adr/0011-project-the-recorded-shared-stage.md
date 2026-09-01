# Project the recorded Shared Stage in the recorder browser

The recorder browser owns recorded Shared Stage policy: the SFU supplies an authenticated recorder-safe projection, and one browser Module applies it to the standard Meet stores and `MeetingLayout`. SFU-owned layout and recorder branches inside the shared participant layout were rejected because they would spread recording policy away from the rendered capture and reduce reuse.

## Consequences

- The SFU returns one recorder-specific snapshot with a monotonic room-event cursor and sends subsequent projection events with ordered cursors and canonical SFU-observed timestamps.
- Initial capture readiness requires Recording Grant proof, Meet Room join, receive transport connection, snapshot and buffered-event reconciliation, playback attachment for every current producer, and one committed layout frame.
- Capture launch uses a two-step handshake. `prepare_capture` clears and buffers transient overlays and commits a clean frame; after FFmpeg launches and durably records its timestamp, `capture_started` releases only qualifying public chat and reactions.
- Persistent participant, media, screen-share, and raised-hand state survives the capture-start reset. Startup and interruption-period transient overlays do not enter the Recording Artifact.
- Recovery after a Recording Interruption repeats snapshot reconciliation, media attachment, transient reset, and rendered-frame readiness before a new capture epoch launches.
- Unknown or invalid recorder projection data fails closed into a Recording Interruption and fresh snapshot recovery within the existing deadline.
- Most tests drive snapshots, ordered events, synthetic media, and capture handshakes through the projection Module's Interface. One real SFU-to-browser-to-FFmpeg test decodes representative video frames and audio to verify the complete path.
