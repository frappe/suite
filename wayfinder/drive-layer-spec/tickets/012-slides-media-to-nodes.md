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
