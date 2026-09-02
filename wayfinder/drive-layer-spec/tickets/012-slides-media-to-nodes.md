---
id: 012
title: Slides media to nodes
label: wayfinder:grilling
status: open
assignee:
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
