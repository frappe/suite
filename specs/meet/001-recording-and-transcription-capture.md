# Recording and transcription capture

Status: accepted; original-language-only v1 confirmed 2026-10-21, implementation and model validation pending

Scope: The v1 participant-facing flow for selecting and capturing video recording, transcription, or both. Acceptance records the confirmed product contract, not implementation or model readiness.

Use the terms in [Meet context](../../suite/meet/CONTEXT.md). Related contracts cover [batch processing](002-batch-transcription.md) and [artifact delivery](003-capture-artifact-delivery.md). The [confirmed design brief](../../suite/meet/docs/transcription-design.md) records the originating decisions.

## Selecting outputs

- Extend the existing recording start flow with independently selectable video-recording and transcription toggles.
- Support video only, transcription only, and both. Transcription-only capture must not require rendering or saving video.
- Default to video enabled and transcription disabled. At least one output must be selected to start.
- When transcription is selected, automatically handle English, Hindi, and speech switching between them, including within a sentence. Do not require a spoken-language selector. Indian-accented English belongs to the quality-evaluation scope. Selecting transcription produces one Original Transcript in the languages spoken. Translation and a separate English Transcript are deferred; no extra language/output toggle is added. Unsupported or unintelligible passages must be identified rather than converted into plausible speech.
- Selections stay fixed during active capture. To change outputs, stop and start a new capture.
- If both outputs are selected, use one start flow and one stop action. Their later processing and delivery are independent.

## Control and lifetime

- Only hosts and co-hosts may start or stop capture. Enforce this permission on the server.
- The Room Owner owns resulting artifacts regardless of who starts capture.
- Start capture manually. Do not queue a live-capture start behind unavailable capture capacity: reject visibly when it cannot start. Queued transcription processing is a separate stage.
- Capture stops when a host or co-host stops it, when the last participant leaves, or when the four-hour maximum is reached.
- Allow at most one active Transcription Capture per Meet Room. Existing video recording admission and quota behavior continues to apply when video is selected.
- Starting again creates a separate capture and separate resulting artifacts. A persistent Meet Room does not imply one lifetime Transcript.
- Earlier captures may still be processing when another capture starts, subject to configured admission limits.

## Participant visibility and encryption

- Show a start notice and a persistent indicator identifying active transcription. Late joiners receive a notice as well.
- When both outputs are active, notices and indicators must communicate both recording and transcription. Transcript-only capture must not imply video is being saved.
- Notices are informational, not individual opt-in. Notice delivery does not gate publication of a late joiner's media.
- Transcription is unavailable in an End-to-End Encryption room. Reject attempts to start it under E2EE on the server as well as in the UI.
- Enabling E2EE requires stopping active transcription capture first, consistent with the existing recording restriction.
- Use the existing start/indicator/stop interaction pattern. Do not add a dedicated transcription job-status, cancellation, or retry view.
- Processing lifecycle states may exist internally. Do not show pending placeholder files in Drive or an unvalidated completion estimate.

## Audio and timing

- Preserve separate participant speech sources and their participant identities on a shared capture timeline for later speaker attribution.
- Transcription capture runs for its selected interval regardless of whether anyone subscribes to live captions. Turning captions off or losing the final caption subscriber must not stop it.
- Preserve capture-based speech-segment timing; recognition-response arrival time is not the source of Transcript timestamps.
- Preserve the relationship between paired video and Transcript outputs and the timing information needed to map captured speech onto video playback, including omitted video gaps.
- Existing video composition, recorder authorization, and Shared Stage behavior remain governed by the relevant [Meet context](../../suite/meet/CONTEXT.md) and recording ADRs. A shared start dialog does not replace those contracts.

## Interruptions

- Make capture interruptions visible to participants and identify known gaps in any usable partial Transcript.
- Preserve recoverable captured audio. Deliver a marked partial Transcript when recoverable speech can be transcribed; do not invent text to fill gaps.
- A capture-service restart ends the active capture and does not automatically resume it. Hosts may explicitly start a new capture when service is available again.
- Failure of one selected output must not discard a usable result from the other. This does not promise an output can survive loss of its required source media.

## Acceptance scenarios

1. With transcription selected and video disabled, a host can capture speech without any video output being produced. A participant who enables or disables live captions does not change the capture lifetime.
2. With both selected, a co-host starts capture and another host stops it. Result ownership remains with the Room Owner, and both selections stay fixed during capture.
3. With neither selected, capture cannot start. An ordinary participant cannot bypass host-only control by directly calling the server.
4. A late joiner sees the active transcription notice and indicator. A transcript-only capture does not claim that video is being recorded.
5. An E2EE room rejects transcription. An attempt to enable E2EE during capture requires stopping capture first.
6. Capture stops when the final participant leaves or after four hours. A subsequent start produces a distinct capture rather than appending to the previous Transcript.
7. A service restart leaves recoverable speech available for partial processing, flags known gaps, and requires an explicit new start to capture further speech.
8. Saturated live-capture capacity produces a visible rejection rather than silently starting later and omitting the intervening conversation.

## Deferred

Changing selections during capture, languages beyond English/Hindi, individual participant opt-in, playback subtitles, English translation/rendering and live Hindi–English translation are outside v1. Sharing vocabulary with live captions does not add translation.
