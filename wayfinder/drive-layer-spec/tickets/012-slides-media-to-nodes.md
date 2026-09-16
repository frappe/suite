---
id: 012
title: Slides media to nodes
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: [006]
---

## Question

Slide images are framework File attachments authorized by a separate
(src, presentation) endpoint (`slides/api/file.py`); no permission model
can absorb that. Decide the mechanism for slide media as Drive Nodes under
the deck node (as Writer embeds already are): node placement, copy-paste
across decks under content addressing, the serving URL scheme inside slide
elements, and what replaces the 122-line media streamer. Blocked by
Renditions and thumbnails model (media thumbnails ride on it).

Red-team walkthrough: scenario S7 (media half).

Handed from [Publishing capability](007-publishing-capability.md)
(2026-09-03): composite decks are no longer forced public. Rendering a
composite does one READ check per referenced deck for the viewer's
principals and skips what they cannot read, so the media half must
authorize a reference's media through that reference's own node, never
through the composite. Also decide here what a Slides template is: today
`is_template` decks are readable by everyone in code
(`presentation.py:496`), which "sharing has one home" (005) forbids.
Proposed: templates are nodes under a system-owned folder with a
`$GENERAL` READ grant.

Handed from [Migration mapping](011-migration-mapping.md) (2026-09-04):
Build migrates only File rows reachable from the `Drive` or
`Users/<email>` folders. Slide media are framework File rows with
`attached_to_doctype = Presentation`, so Build does not touch them. This
ticket must define its own Build step (which attachments become nodes,
under which deck node, and how slide elements are rewritten to the new
URLs), following Build's rules: ids survive, additive, id-keyed reruns,
counts in the report.

## Resolution

Decided with Faris, 2026-09-04. Nine decisions. An agent surveyed the current
code first (`suite/slides/api/file.py`, `suite/slides/doctype/presentation/
presentation.py`, `suite/writer/api/embed.py`, `suite/writer/overrides/
__init__.py`, `suite/drive/overrides/file.py`, the Slides frontend media and
offline modules). A visual explainer was written beside the decisions:
`wayfinder/drive-layer-spec/explainer/slides-media.html`.

### 1. A media node is a child of the deck node

Slide media becomes an ordinary Drive Node under the deck node, as Writer
embeds already are (`writer/api/embed.py:12`). Read on the deck covers its
media through the same nearest-wins path walk, so Slides keeps no permission
code.

A content document node is always a leaf in every listing. Drive is the only
list view in Suite, and a deck, a document, and a sheet all open their editor
when clicked. No listing descends into a content document, so media nodes are
never shown. This is one rule for every content app, not a Slides case.

Rejected: a hidden `.media` folder under the deck (a reserved name to defend,
for tidiness the leaf rule gives free). Rejected: a `Drive Node Attachment`
side table (previews, quota, and GC are all defined on nodes). Rejected:
nodes in the uploader's root with a grant per viewer (today's coupling in a
new table).

### 2. The slide holds the node. The wire carries a signed blob link.

The element's `src` holds the media node id. When Drive returns a deck's
media it checks the deck once, then mints short-TTL signed `/f/` URLs for the
blobs and returns them. The browser fetches those directly.

This is the serving pattern ticket 006 chose for previews. Python leaves the
byte path entirely, so byte ranges, conditional requests, and resume come
from the file server. Video needs Range on non-local drivers, which is the
framework ask ticket 009 already states.

Rejected: `src` holding a blob address; permission then needs a search for a
readable node holding that blob, which is rule 1 of the old endpoint rebuilt.
Rejected: `src` holding a Drive URL streamed by Python; that keeps a streamer
and caches one picture once per deck.

### 3. Short links, refreshed by the page

The deck page re-requests its media links on a timer before they expire. The
TTL is the Drive-wide signed-URL setting shared with previews; Slides does
not pick a number.

Offline is stated, not implied: pinning a deck keeps its pictures until the
deck is unpinned. Unsharing does not reach into a pinned cache. This is the
same promise as downloading a file and is what pinning does today.

Rejected: a long TTL (a day-long window is a different security promise).
Rejected: a permanent `/drive/media/<node>` address that redirects; it costs
one permission check per picture, which is the per-picture cost being removed.

Consequence: everyone fetches `/f/<blob>`, so the pinned-cache key is the blob
with the signature stripped. `frontend/src/apps/slides/utils/canonicalMediaKey.ts`
is deleted, and one picture is one cache entry across every pinned deck.

### 4. Copy across decks, reuse inside one

Pasting media into another deck copies the node: a new node under the
destination deck, the same blob, no bytes moved. The pasted elements' `src`
is rewritten to the new node. This is the copy primitive of ticket 014 (new
node owned by the caller, charged to the destination root, no grants and no
versions copied). The caller must be able to read the source node, as today
(`presentation.py:452`).

Inside one deck, one node per blob: pasting the same picture twice reuses the
node, so a logo on twenty slides is one node and one charge.

Accepted cost: ticket 010 charges per node reference, so a 50 MB video in
three decks is 150 MB of quota against one 50 MB blob. A deck you can delete
alone must cost you something.

Rejected: referencing the source deck's node; opening the destination would
need read on the source, and deleting the source would empty the copy.

### 5. Drive sweeps unused media. The app answers one question.

Removing a picture from a slide tells Drive nothing, because slide content is
opaque JSON (`slide.json:25`). Today the file survives forever
(`suite/slides` has no `scheduler_events` entry). Now it would also cost
quota.

Drive owns the whole mechanism: it picks the nodes to check, keeps the grace
period, runs the job, and trashes what is unused. Each content app declares
one function, "list the nodes you still use". No app writes sweep code, and
the function cannot live in Drive because only the app can read its own body.

This is a new line in the content app contract (ticket 005), so Writer's
pasted embeds get the same cleanup with no Writer code.

Unused media is trashed, not purged: it lands in the owner's bin and follows
the normal 30-day clock. Nothing in this map deletes a person's content
without showing it to them.

Rejected: never deleting (today's behaviour with a bill attached). Rejected:
deleting when the element is removed; undo loses the picture, and with two
people editing "removed" is not yet a fact.

### 6. A template is a document you may read, marked as a starting point

Generalised beyond Slides at Faris's direction. Two apps ship templates and
both write the permission in code: `presentation.py:496` (everyone reads any
`is_template` deck) and `writer/overrides/__init__.py:16` (everyone signed in
reads any `Writer Template`). Sheets has none yet and would invent a third
shape.

Only two things happen to a template: list the ones you may start from, and
make a new document from one. Drive does both already, and the second is
`copy`.

- `is_template` is one flag on `Drive Node`, for every content app.
- Who may use a template is the grant on its node. Nothing else.
- Listing is one Drive query: readable, flagged, of this content type.
- "New from template" is `copy` plus the app's declared duplicate.
- Shipped templates are decks in Administrator's Personal Root with a
  `$GENERAL` READ grant. Every site has an Administrator, so this works on a
  business site and a personal site alike (ticket 001).
- A company template is any document marked and shared. No code.

Two rules come with it: templates are hidden from ordinary listings and
appear only in the template picker, or every user's shared view fills with
"Light" and "Dark"; and shipped templates are granted to `$GENERAL`, not
`$PUBLIC`, because a logged-out visitor views a published deck but never
starts a new one.

This deletes both bypasses, the `Writer Template` doctype and its two
permission functions, the Slides `is_template` branch, the
`after_insert` early return that leaves a template without a node
(`presentation.py:43`), and `is_template_media` (`api/file.py:69`). The last
one goes because decision 4 copies the node when a layout is applied, so a
template's picture becomes the user's picture and nothing reaches back.

Rejected: a `Templates` folder convention (marking an existing document means
moving it, and "mine" versus "the company's" becomes folder layout instead of
a grant). Rejected: shipping templates as app data outside the tree; it
answers the permission question by deleting it, but only Frappe could ever
author a template.

### 7. A composite authorizes through the reference, and may reference anything the author reads

Confirms the media half handed over by ticket 007. Opening a composite runs
one READ check per referenced deck for the viewer's principals. For each
readable reference Drive inlines its slides and mints links for that
reference's media. Being named by a composite grants nothing. Nothing is
copied; the composite stays a live view.

The save-time rule "every reference must be public" (`presentation.py:29-40`)
becomes the ordinary read check: you may reference what you can read. A
composite is a view, so its contents differ by viewer. Rejected: a save-time
rule that every composite viewer can read every reference; access is revoked
an hour later and the rule silently fails.

The forced-public row on save (`presentation.py:47-60`) is deleted, per
ticket 007.

The API stops dropping unreadable references silently
(`presentation.py:571`). It returns the reference marked unreadable and the
client chooses whether to draw a placeholder. Screen design belongs to the UI
effort, which this map rules out of scope.

### 8. The deck preview is a preview row, written without a touch

`Presentation.thumbnail` and its File handling go. Slides keeps its browser
capture and pushes the ready image through the Drive call ticket 006 defines,
which writes `Drive Node Preview`.

Pushing a preview is not an edit and owes no `touch` (ticket 005). Today the
write deliberately skips `modified` (`presentation.py:184`) because bumping
it makes the open editor discard unsynced local changes. A touch would also
reorder a modified-sorted listing because somebody looked at a deck.

Duplicating a deck copies the preview row, pointing at the same preview blob.
The duplicate looks right at once and is refreshed the next time a person
opens it. `copy_thumbnail_file` and `adopt_thumbnail`
(`presentation.py:361-395`) go with the field.

Accepted consequence: a deck gets its picture only when a person opens it in
the editor. A deck made by script or by migration has no preview until then.
Ticket 006 already ruled that Drive never renders a document and documents get
no sweep, so this follows.

### 9. Convert before the node exists

Today Slides stores the upload, converts it to webp by rewriting the on-disk
path, then deletes the original File (`presentation.py:590-612`). Ported
literally this becomes create-then-replace, and ticket 006 keeps a replaced
head as an `auto` version, which ticket 010 charges. Every image upload would
leave a paid-for dead copy of itself.

Instead: the bytes arrive, Slides converts them to webp, then Drive creates
the node. One node, one blob, no version, nothing to delete, and no stale
`attachmentName` in saved slide JSON.

The conversion stays in Slides, before the Drive call. Drive must not convert
what people upload: a PNG put in a drive comes back a PNG. No new Drive
concept is needed. Rejected: converting in the browser; the server then
guarantees nothing, and video still needs the server.

### What goes

| Deleted | Lines |
|---|---|
| `suite/slides/api/file.py` | 122 |
| `suite/slides/api/test_file.py` | 274 |
| `frontend/src/apps/slides/utils/canonicalMediaKey.ts` | 31 |
| `Writer Template` doctype, `filter_templates`, `template_has_permission` | — |
| `is_template` branch, `presentation.py:490-498` and `:43` | — |
| forced-public composite row, `presentation.py:29-60` | — |
| thumbnail File handling, `presentation.py:107-188`, `:361-395` | ~120 |
| webp convert-and-delete, `presentation.py:583-626` | ~44 |

Rewritten: `get_attachment`, `attach_poster`, `update_slide_attachments`,
`get_updated_json` (`presentation.py:240-487`) call the Drive copy instead of
`frappe.copy_doc`; `getAttachmentUrl` (`mediaUploads.js:112-139`) loses its
owner and viewer branches; the service worker's media classification
(`slidesRequests.js:36`) and the pinning store key on `/f/` blobs.

### Handed off

- One new declaration, "list the nodes you still use", plus templates as a
  node flag -> content app contract, through Draft the spec (005 is closed).
- Slide media File rows become child nodes of the deck node; a video poster is
  a media node like any other; template decks gain nodes and a `$GENERAL` READ
  grant; `Writer Template` rows become Writer Documents with `is_template`;
  `Presentation.thumbnail` Files become `Drive Node Preview` rows; the
  `attachmentName` field and `/private` prefixes in `elements` JSON are
  rewritten to node ids -> Migration mapping (011).
- The deck-media call and its refresh, the template list and create-from
  calls, and the composite response that marks unreadable references ->
  HTTP API surface (014).
- `Drive Node.is_template`, the unused-node sweep with its grace period, the
  preview push that owes no touch, and the leaf rule for content document
  nodes -> Draft the spec (013).
- Glossary updated: Template added, Content Document noted as a leaf
  (`suite/drive/CONTEXT.md`).
