# Capture artifact delivery

Status: accepted; original-language-only v1 confirmed 2026-10-21

Scope: The v1 Drive organization, Original Transcript presentation, notifications, access and deletion behavior for new outputs from the [shared capture flow](001-recording-and-transcription-capture.md).

Use the definitions in [Meet context](../../suite/meet/CONTEXT.md). Processing follows [the batch contract](002-batch-transcription.md). This changes organization for new outputs; it does not migrate existing artifacts.

## Output organization

- Put new outputs in the Room Owner's Drive under Meet, grouped in a child folder named from its Meet Room title and capture start time.
- Store selected usable outputs as Recording.mp4 and Original Transcript.txt. Selecting transcription requests one original-language file; it does not require video or another capture toggle. Do not create an English Transcript in v1.
- Create the child folder only when its first usable output is ready. Later outputs from that capture join the same folder, even if processing takes much longer.
- Distinct captures remain distinct even when room titles or displayed start times collide. Leave existing Meet Recordings folders and older single-Transcript artifacts in place.
- Do not create placeholder files or empty processing folders for queued, processing or entirely failed jobs.

## Transcript presentation

- The Original Transcript preserves the languages spoken, participant attribution and capture-based speech-segment timestamps. Target Hindi in Devanagari and English words in Latin script; add punctuation without translating or rewriting meaning. It is a readable original-language transcript, not unprocessed model tokens.
- Do not summarize the conversation, invent connective explanations, silently turn tentative statements into commitments, or discard corrected statements and their context.
- Preserve overlapping speakers as separately attributed speech. Use captured speech timing rather than response-arrival times; segment timing is not precise word alignment.
- Mark detected uncertain passages with timestamps and explicitly identify partial results and known missing intervals. Do not imply that all errors or uncertainty are detectable. Do not translate or rewrite unclear speech into a plausible sentence.
- Offer plain-text downloads. The generated Original Transcript is read-only; users may download a copy to edit outside the feature. It remains an owner-controlled Drive artifact when temporary processing inputs are deleted.
- Do not add English translation/rendering, correction tools, version history, summaries, action items or live transcript delivery in v1. Selectable playback subtitles remain v2; preserve output pairing and timing for that work.

## Availability and notifications

- Publish one usable complete or explicitly partial Original Transcript after recognition and artifact publication complete, with one transcription completion notification. Inference checkpoints alone do not mark the job ready. There is no translation dependency, paired English file or rendering-failure notice.
- Video publishes independently of the Original Transcript. Do not delay usable video for transcription, or discard usable transcripts because video fails. Video and transcription may produce separate emails when their outcomes finish separately.
- After bounded retries, deliver a clearly marked partial Original Transcript when some recognized speech remains usable. If no transcript is usable, create no transcript file and send the owner an explicit transcription-failure notice.
- Publication and recovery must be idempotent. Interrupted publication must not duplicate the Original Transcript or falsely signal availability. Notify only after the final complete, partial or failed transcription outcome is established.
- Email only the Room Owner with direct Drive links to the available artifacts and explicit partial/failure information. Do not add attendee grants, in-app post-processing notifications or a dedicated job-status/cancellation/retry view.
- Do not show a completion estimate until measurements support one. The internal one-hour target is not a promised delivery time.

## Ownership and access

- The Room Owner owns every selected output even if a co-host initiated capture. Attendees, room members and other site users receive no automatic artifact grant.
- Use normal Drive sharing, revocation and administrative access semantics. Destination selection must preserve owner-only access; a shared destination must not silently expose new content through inheritance.
- Private blob storage is not proof of owner-only access; enforce effective Drive permissions independently for the video and Original Transcript.

## Deletion

- Use reversible Drive trash behavior for completed artifacts. A delivered Original Transcript is retained until normal user-controlled deletion; it is not discarded as a temporary intermediate.
- Keep artifact deletion independent: deleting the Original Transcript must not delete its paired video, and deleting video must not delete the transcript solely because they share a folder.
- Permanent deletion must remove that artifact's associated metadata and fence later completion/recovery from recreating it. Preserve shared capture metadata still needed by surviving artifacts.
- Coordinate remaining source-audio cleanup with active output dependencies and the bounded source-retention policy. Video publication/deletion or recognition alone cannot remove audio still required by transcription.
- Do not expose deletion/cancellation of pending jobs through placeholder Drive files; pending jobs have no such file.

## Acceptance scenarios

1. A transcript-only capture completes. The owner receives a link to Original Transcript.txt in one Meet capture folder; no Recording.mp4 or English Transcript.txt is created.
2. Video completes first and remains usable. The Original Transcript publishes later in the same folder with one transcription notification and no translation wait.
3. Video succeeds but no transcript is usable. Video remains, an explicit transcription-failure email goes to the owner and no transcript placeholder appears.
4. All outputs fail. No empty capture folder or placeholders are created.
5. A co-host starts capture. Outputs and emails belong to the Room Owner; starting capture creates no automatic co-host artifact grant.
6. An attendee without a Drive grant cannot read the Original Transcript. Explicit sharing grants access under normal Drive rules.
7. A shared Meet destination would expose new content through inheritance. Creation preserves owner-only effective access.
8. Audio or recognition has missing sections. A usable partial Original Transcript identifies omissions and preserves attribution/timing for successful sections.
9. Recognition succeeds on Hindi-English speech. The original-language file publishes without any English-rendering stage, translated sibling or rendering-failure notification.
10. Trashing/restoring the Original Transcript uses normal Drive behavior. Permanently deleting it fences its recreation without removing video.
11. A crash interrupts transcript publication. Recovery delivers one Original Transcript and sends no misleading completion or duplicate notification.
12. New captures use Meet grouping while previously stored artifacts retain their original names and locations.
