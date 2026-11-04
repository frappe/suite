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

## Shared conversational ranking

The SFU owns the room's versioned conversational ranking, including sustained
activity and recent speaker turns. Human endpoints receive it on join/rejoin and
as full versioned updates; the recorder receives the same state in its safe
snapshot and ordered projection. The browser still owns layout: it projects this
room ranking through viewport capacity, the local self tile, and personal pins.
This removes independent browser history from default membership and order
without moving viewport or recording-readiness policy into the SFU.

### Stable presentation slots

Conversational priority selects each capacity's participant set; it does not
specify tile positions. The SFU snapshots a presentation order for each supported
ranked prefix (1–16 tiles). Retained members keep their slots and entrants fill
vacancies. Equal-priority joins follow room arrival order, so a new identifier
cannot evict an incumbent merely by sorting earlier. Departures that reduce the
population move tail survivors only when needed to fill a hole.

The SFU also maintains these orders after each human endpoint's self exclusion,
and sends only that endpoint's projection on join and updates. This prevents local
speaking priority from changing remote slots. Endpoints project the received
orders through screen tiles and capacity. Unpinned defaults have no browser
presentation history; fresh join/reconnect snapshots reproduce the room's current
presentation.

Pinned layouts keep their panels in pin order. Their unpinned strip
starts from the shared presentation, then retains local slots while pin settings,
viewport capacity and screen layout are unchanged. Selection still follows shared
priority; entrants fill vacancies. Interior vacancies remain empty when no
replacement is available, so survivors do not move. The overflow tile reserves
a vacancy when first needed and retains it through selection changes. Only the current personal layout is
retained, without server histories for pin combinations. Pin/unpin, viewport and
screen-layout changes may reset these slots. Sidebar column count follows viewport
capacity so participant joins do not resize the pinned panel.
