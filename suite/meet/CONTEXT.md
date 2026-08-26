# Meet

Meet provides persistent rooms in which participants communicate through live audio, video, screen sharing, chat, and other shared-stage interactions.

## Language

**Meet Room**:
A persistent joinable space whose membership and meeting policies survive individual calls.
_Avoid_: Meeting Session, Call

**Participant Connection**:
One browser endpoint's live connection to a Meet Room, from join setup through cleanup. A participant switches explicitly when joining from another tab or device.
_Avoid_: Meeting Session, SFU Session

**Recording Session**:
One continuous interval beginning when an authorized start is accepted and ending when recording stops.
_Avoid_: Recording Job, Recording File

**Recording Artifact**:
A valid complete or partial composed video produced after a Recording Session ends.
_Avoid_: Recording Session, Raw Tracks

**Partial Artifact**:
A Recording Artifact known to omit part of its Recording Session because capture was interrupted or ended unexpectedly.
_Avoid_: Failed Recording, Recording Segment

**Recording Interruption**:
A period during an active Recording Session when the Recorder Endpoint cannot capture the Shared Stage.
_Avoid_: Recording Stop, Processing Failure

**Room Owner**:
The user who owns the Meet Room and the Recording Artifacts produced in it.
_Avoid_: Recording Initiator

**Recording Initiator**:
The host or co-host who starts a Recording Session, whether or not they own the Meet Room.
_Avoid_: Room Owner

**Recorder Endpoint**:
A non-participant system endpoint that observes a Meet Room to produce a Recording Artifact.
_Avoid_: Participant, Recording Initiator

**Shared Stage**:
The participant-visible meeting presentation composed from shared media and room-wide interactions.
_Avoid_: Host View, Meeting Controls

**Recording Notice**:
The informational participant-facing announcement that a Recording Session is starting or already active.
_Avoid_: Consent, Opt-in

**Recording Estimate**:
The advisory duration and artifact size shown before a Recording Session starts.
_Avoid_: Recording Limit, Scheduled End

**Recording Budget**:
The Drive storage allowance reserved for one Recording Session.
_Avoid_: Recording Estimate, Drive Quota

**Recording Capacity**:
The number of Recording Sessions the configured recorder deployment can capture concurrently.
_Avoid_: Recording Budget, Meeting Capacity

**Meet Media Deployment**:
A Press infrastructure cluster-scoped managed unit containing shared, separately scalable SFU and recorder services for the Suite sites assigned to that cluster.
_Avoid_: Meet Service Cluster, Per-Site Media Deployment

**Recording Grant**:
A single-use, proof-bound authorization for one Recorder Endpoint to observe one Meet Room for one Recording Session.
_Avoid_: Participant Token, Recorder API Key

**End-to-End Encryption**:
A Meet Room policy under which only admitted participant endpoints may decrypt live media.
_Avoid_: Server-side Encryption

## Relationships

- Global recording availability gates new sessions; disabling it does not interrupt an active Recording Session.
- An authenticated participant has at most one active **Participant Connection** to a Meet Room and switches explicitly between tabs or devices.
- A **Meet Room** can have many **Recording Sessions** over its lifetime.
- A **Meet Room** has at most one active **Recording Session**, but earlier sessions may still be processing when another begins.
- A **Recording Session** produces at most one **Recording Artifact**.
- A **Recording Session** may exist without a **Recording Artifact** while it is active or processing, or after an unrecoverable failure.
- A failed **Recording Session** with no Recording Artifact is retained for 30 days and then deleted automatically.
- A **Recording Artifact** may begin after its Recording Session when recorder startup takes time.
- A Recording Session with one or more known capture gaps produces one **Partial Artifact**, not multiple artifacts.
- A **Partial Artifact** omits known gaps from playback and records their session timestamps as metadata; it does not synthesize filler media.
- A recorder service restart ends the active Recording Session and does not resume capture automatically. The Room Owner receives a Partial Artifact when valid captured media exists; otherwise the session fails without an artifact. A host or co-host may start a new Recording Session after the recorder becomes ready.
- Other transient capture failures may lose up to the current 30-second capture interval before recovery.
- A **Recording Interruption** is visible to all participants and may recover for up to 60 seconds before the Recording Session stops; it produces a Partial Artifact only when valid captured media exists, otherwise it fails without an artifact.
- A **Recording Artifact** belongs to exactly one **Room Owner**.
- A **Recording Artifact** appears in Drive only after its video is valid and ready.
- A **Recording Artifact** is named from its Meet Room title and Recording Session start time.
- Only the **Room Owner** receives post-processing ready, partial, or failed notifications.
- Trashing a **Recording Artifact** follows normal reversible Drive behavior; permanently deleting it also deletes its Recording Session metadata.
- A **Recording Initiator** controls a **Recording Session** but does not thereby own its **Recording Artifact**.
- A **Recorder Endpoint** observes the **Shared Stage** but does not count as a participant or keep the room human-occupied.
- A **Recording Artifact** contains the **Shared Stage**, including public chat messages sent after artifact capture begins but not earlier chat or messages sent during recorder startup.
- The recorded **Shared Stage** uses the current desktop Meet layout at 1920x1080: screen shares auto-pin with the standard sidebar, otherwise participants use the standard grid and overflow priorities.
- The **Recorder Endpoint** never appears as a tile in the recorded Shared Stage.
- The recorded **Shared Stage** includes names, avatars, active-speaker treatment, reactions, raised hands, timed public-chat overlays, and a small recording timer.
- The recorded **Shared Stage** excludes meeting controls, sidebars, polls, menus, private notifications, and personalized participant state.
- A **Recording Notice** informs participants but does not represent explicit individual consent.
- A **Recording Notice** and live recording indicator appear immediately when the Recording Session begins; there is no countdown.
- A late joiner's media may enter an active **Recording Session** immediately; a **Recording Notice** does not gate publication.
- A scheduled **Recording Estimate** uses the time remaining in the Calendar event plus a 15-minute overrun allowance.
- A recurring scheduled **Recording Estimate** uses one occurrence's full event duration plus a 15-minute overrun allowance.
- An ad hoc **Recording Estimate** assumes one hour.
- A **Recording Estimate** does not stop a Recording Session; quota and the four-hour maximum do.
- A **Recording Budget** constrains a Recording Session independently of its Recording Estimate.
- A **Recording Budget** grows automatically when the Room Owner frees sufficient Drive space, up to the four-hour session maximum.
- When a **Recording Budget** will end a session early, hosts and co-hosts receive warnings at ten minutes and two minutes remaining.
- A Recording Session starts only when **Recording Capacity** is immediately available; recording requests are never queued.
- A **Meet Media Deployment** is shared by the Suite sites assigned to one Press infrastructure cluster; its SFU and recorder services remain separately deployable and scalable.
- A **Recorder Endpoint** can observe media only after proving possession of the ephemeral key bound to its **Recording Grant**.
- A **Recording Grant** is valid for exactly one site, Meet Room, Recording Session, Recorder Endpoint, and initial SFU connection.
- An **End-to-End Encryption** Meet Room cannot start a Recording Session.
- **End-to-End Encryption** cannot be enabled during an active **Recording Session**; the session must be stopped first.

## Example Dialogue

> **Dev:** "If a co-host starts recording and stops it ten minutes later, who owns the video?"
> **Domain expert:** "That is one Recording Session. Its Recording Artifact belongs to the Room Owner, not the Recording Initiator. Starting again creates another Recording Session and another Recording Artifact."

## Flagged Ambiguities

- "Meeting" was used for both the persistent room and a live occurrence. Resolved: **Meet Room** is the durable domain entity; recording does not introduce a separate live Meeting Session entity.
- "Recording" was used for both the active interval and its resulting video. Resolved: **Recording Session** is the interval; **Recording Artifact** is the video.
- "Consent" was used for participant notification. Resolved: the MVP provides a **Recording Notice**, not explicit participant opt-in.
