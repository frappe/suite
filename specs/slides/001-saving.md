# Slides: when a deck is saved

Status: proposed
Review: Gursheen (pending)

Scope: how the Slides editor saves a presentation, what happens to edits that have not been saved, and what other people see while a deck is being edited. This spec records today's behaviour. Faris decided to keep it and have it reviewed ("keep slides behaviour and document it"). It proposes no code change.

Code: `frontend/src/apps/slides/surface/SlidesSurface.vue` (the timer), `frontend/src/apps/slides/stores/saving.js` (the save), `frontend/src/apps/slides/stores/presentation.js` (the request), `suite/slides/api/slides.py` (`save_slides`).

## Behaviour

### When a save starts

Every edit marks the deck as dirty. A timer checks every 1 second. It starts a save when all of these are true:

- the deck is dirty;
- the user can edit (not view only, not locked by another tab, not refused);
- no drag or resize is in progress;
- no slide is focused in the slide panel.

There is no debounce. The 1 second timer is a poll, not a delay after the last keystroke. Typing in a text box does not block it: a save can start while the user types.

A slide is "focused" when the user clicks a thumbnail in the slide panel, or adds or jumps to a slide (`changeSlide` focuses by default). The slide stays focused until the user selects something on the canvas, deletes the slide, or starts a slideshow. The check is `!focusedSlide.value`, so the first slide (index 0) never blocks a save. Every other slide does.

Other triggers:

| Trigger | What happens |
| --- | --- |
| Save shortcut | Clears focus, then saves at once. Shows "Saved", or "No changes to save". |
| Network comes back | Saves at once, without the retry delay. |
| Leave the editor (route change) | The leave guard waits for a save in progress. If the deck is still unsaved, it keeps a recovery copy and asks the user to confirm. |
| Editor unmounts | Clears focus and starts one last save, without waiting for it. |
| Close or reload the tab | Nothing. There is no `beforeunload` or `pagehide` handler. |

### What one save does

- The editor sends the whole slide list to `save_slides`, with `base_modified`, the version it built on.
- The server refuses the save if `base_modified` is not the current version (`TimestampMismatchError`). It never merges. Slide rows are matched by `client_id`.
- A request that takes longer than 30 seconds is cancelled.
- An edit made while a save is in progress is queued. The deck stays dirty and the next tick saves it.
- The header shows one of: saved, saving, unsaved, not saved (failed).

### Unsaved edits

The edits live in memory. The local copy in the browser (IndexedDB) is written inside the same save call, so it is skipped for as long as saving is skipped.

| Situation | Result |
| --- | --- |
| A slide is focused in the panel | No save and no local copy. Edits are in memory only. The header shows "Unsaved". |
| Tab closed or browser crashed while edits are unsaved | The edits are lost, unless a local copy was written by an earlier tick. |
| Network drops | The local copy is written. The save waits for the network, then runs. |
| Server error | The deck stays dirty. The save retries with a delay that doubles, up to 30 seconds. The header shows "Not saved". |
| Another editor saved first (version mismatch) | The deck becomes read only. The edits are kept in the local copy. The user must reload. |
| Edit access removed | Saving stops. A recovery copy is kept on the device and the user can download it as a JSON file. |
| Same deck open in two tabs of one browser | Only one tab edits (Web Locks). The other is read only. |

On the next open, a local copy that is newer than the server is restored. A local copy that never reached the server and is older is discarded with the message "Changes that never reached the server were discarded."

### What other people see

Other people see changes only after a save, and only after they reload the deck. Slides has no realtime channel, no presence and no cursors. A second editor who saves from an older version is refused, and their deck turns read only.

### Compared with Writer and Sheets

| | Slides | Writer | Sheets |
| --- | --- | --- | --- |
| Save trigger | 1 second poll, blocked while a non-first slide is focused or a drag is running | 5 second debounce after an edit | 2 second debounce after an edit |
| Save on unmount | Yes, not awaited | Yes | Yes, with `keepalive` so it survives |
| Live collaboration | None | Yes (Yjs over WebRTC) | None |
| Concurrent editors | Second saver is refused | Edits merge | Not covered here |
| Content sent | Whole slide list | Yjs state and HTML | Whole sheet |

The Writer and Sheets rows come from `writer/composables/useYjs.ts` and `sheets/components/SheetEditor/index.vue`. Check them when this spec is reviewed.

## Why it works this way

The history gives reasons only in part. Commit messages are empty for most of these changes.

- The save skips while the user is busy on the canvas. The first version (Nov 2024, `650579f21`, "autosave after set duration") polled every 500 ms. A later fix (Mar 2025, `7ad155272`, "don't autosave when focusElement set") also skipped while a text element was being edited. A drag or resize check followed (Aug 2025, `4a480d77d`). The likely reason is that a save must not run while an element is changing under the user's hands. No commit says so.
- The check moved from "a text element is being edited" to "a slide is focused in the panel" when Slides moved onto the shared surface (Sep 2026, `14fbeb942`). The code now blocks on a different state than the earlier fix did. Nothing in the history says this was a choice.
- The whole-list save with a version check came from a data loss bug (Aug 2026, `153fd1d5b`). A second editor's save wiped the deck. Refusing a stale save is deliberate.
- The refused-save hold, one writing tab, and the local copy came from Gursheen's changes in Sep 2026 (`b7f7228d1`, `ab663f59a`, `94c3b9c64`).

## Risks

1. **Lost edits.** While a non-first slide is focused in the panel, the deck is not saved and no local copy is written. Closing the tab in that state loses the edits since the last save. The leave guard covers only in-app navigation.
2. **Unsaved header.** After "Add slide", the new slide is focused. A user who keeps editing sees "Unsaved" for as long as it stays focused (24 seconds observed, tracker B83). Only moving focus, the save shortcut, or leaving flushes it.
3. **No tab-close protection.** No `beforeunload` handler. Any unsaved edits are lost silently when the tab closes, whatever the focus state.
4. **Index 0 is skipped by the check.** `!focusedSlide.value` is true for slide 1, so slide 1 behaves differently from every other slide. This is almost certainly unintended.
5. **Collaborator view.** A collaborator sees nothing until the editor saves and the collaborator reloads. If two people edit, the second to save loses their session's edits to a read only deck. Their edits are only in the local copy.
6. **Delayed work.** Because saving can be skipped for long periods, the window in which a stale version can be refused is larger.

## Open questions for the reviewer

1. Is blocking the save on panel focus intended, or should it block on canvas activity (text editing, selection) as before? If intended, why?
2. Should slide 1 block like the others, or should no slide block?
3. Should the local copy be written on every tick, even when the server save is skipped? `saveDraft` exists in `saving.js` and nothing calls it.
4. Should the tab have a `beforeunload` handler when the deck is dirty?
5. Should a save while typing be allowed? Today it can run mid-edit. Is that safe for the text editor?
6. Is "second editor is refused and becomes read only" acceptable, or should Slides merge by slide, or show who else is editing?
7. Should the header say why it is "Unsaved" (for example "Saves when you leave this slide")?
