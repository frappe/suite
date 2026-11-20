---
id: 003
title: A page that reads colleagues' busy time
label: wayfinder:grilling
status: open
assignee:
blocked-by: []
---

## Question

A team page must know when each host is busy. For one host the server reads that host's own
account. Decide how it reads several: as each host in turn, or as one asker who has been shared
everyone's free/busy.

Blocked on the company free/busy share, frappe/suite#1297.

## Inputs

- The mail server shows one person another's busy time only from calendars shared with them
  with Read Free/Busy, and it has no share with everyone.
- The removed busy lookup for invitees (`get_participant_availability`) is on the local branch
  `feat/calendar-participant-availability` (commit bea8d985d): at most 20 people and 14 days.
- v1 reads busy time with `Principal/getAvailability`, the same call.
