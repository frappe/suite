---
id: 002
title: Team pages: several hosts and how they combine
label: wayfinder:grilling
status: open
assignee:
blocked-by: [003]
---

## Question

A page with more than one host. Decide the rules for combining hosts: everyone free (a panel
call), anyone free (round robin), and for round robin, who gets the booking: the least booked,
in turn, or by priority. Decide what the booker sees: the team, or the host they got.

## Inputs

- v1 already keeps a list of hosts per page, a combining rule in the free-slot function and the
  host on each booking, so this adds rules and lifts the limit of one.
- A slot is re-checked while no other booking of the same hosts can be made. With several
  hosts, that hold covers each of them.
