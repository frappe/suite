---
id: 005
title: Sheets adoption contract
label: wayfinder:grilling
status: open
assignee:
blocked-by: []
---

## Question

Sheets is the app furthest from Drive. Decide the three ContentTypeSpec
additions it needs: (1) `related_doctypes` so Sheet Op Log and Sheet
Snapshot resolve permissions through the sheet's node; (2) a declared
quiet-write path that fires no Drive sync (cell autosave already relies on
`db.set_value` firing no doc events); (3) one owner for trash retention
(Sheets has a 30-day purge in `sheets/trash.py`; Drive has its own 30-day
clock). Also: DocShare removal plan for existing shares.

Red-team walkthrough: scenario S9.
