---
id: 001
title: Booking pages, version one
label: wayfinder:grilling
status: closed
assignee:
blocked-by: []
---

## Question

What a booking page is for one host: its model, its link, how free slots are found, what a
booking makes, and how a public page is kept from abuse. Asked in frappe/suite#1263.

## Answer

Decided with Akash on 2026-11-20 and written as
[specs/calendar/003-booking-pages.md](../../../specs/calendar/003-booking-pages.md). The four
choices that keep team pages possible: a page has a list of hosts (one for now), the link is
`/book/<slug>` and names no person, free slots take hosts and a rule for combining them, and
each booking stores its host. The build slices are in the [map](../MAP.md).
