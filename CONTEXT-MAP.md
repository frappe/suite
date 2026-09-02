# Context Map

Suite is one app made of several products. Each keeps its own domain language.
This map lists the contexts that have one written down, and how they meet.

## Contexts

- [Drive](./suite/drive/CONTEXT.md) — stores the site's files as a
  permissioned tree, and lends that tree to the other products
- [Meet](./suite/meet/CONTEXT.md) — persistent rooms for live audio, video,
  screen sharing, and recording

Not charted yet: Writer, Sheets, Slides, Mail, Calendar, Suite Core.

## Relationships

- **Writer → Drive**: a Writer document has a Drive Node standing for it, and
  its embedded images are Drive Nodes beneath that node.
- **Slides → Drive**: a deck has a Drive Node standing for it. Its media are
  framework attachments today, authorized by their own endpoint. Moving them
  under the deck node is decided but not built.
- **Sheets → Drive**: a sheet has a Drive Node standing for it. Its change
  log and collab state stay with Sheets as the document body. Its versions,
  comments, title, and trash state are Drive's.
- **Meet → Drive**: a Recording Artifact becomes a file in Drive. A Recording
  Budget is a reservation held against the Room Owner's Drive quota while a
  Recording Session runs.
- **Mail → Drive**: compose attachments land in one Drive folder that all
  users may add to, and stay there.
- **Calendar → Meet**: a scheduled event's remaining time sets the Recording
  Estimate shown before a Recording Session starts.

Every product above depends on Drive for storage and sharing. Drive depends on
none of them. The one seam is a Content Type declaration: a product tells
Drive how to create, copy, export, version, and purge one of its documents,
and which of its own records are Satellites of the node. Drive holds the
title, place, grants, lifecycle, versions, and comments; the product holds
the body.
