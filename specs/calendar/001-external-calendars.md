# External Calendars

Status: accepted

Scope: calendars this site keeps itself, which the calendar app draws read-only beside the ones
on the mail server. This spec covers the store and how the app reads it. What fills the store
is a source's own spec.

## Why they live on the site

A calendar on the mail server is seen by the people it is shared with, and Stalwart caps that
list (`maxShares`, ten by default). A holiday calendar is about everyone in a company. Kept
here, who sees a calendar is a row per person, or one switch for the whole site.

The cost: these events are in Suite's calendar and nowhere else. They are not on the mail
server, so no CalDAV client shows them.

## The store

- **External Calendar** has a name, a colour, the `source` that keeps it, and the `source_key`
  that source knows it by. One source keeps at most one calendar per key.
- **External Calendar Event** has a `uid` from the source, a title, notes, a start and an end,
  whether it is all-day, and whether it repeats yearly.
- **External Calendar Assignment** assigns a calendar to one user.
- A **site-wide** calendar is drawn for every user of the site. Its assignments are kept but
  make no difference while it is site-wide.

## What a source does

A source states what its calendars are called, what is on them and who they are for. Each call
replaces what was there, so a run is repeatable and what the source drops is removed.

- `upsert_calendar` makes the calendar for a key, or updates its name, colour and whether it is
  site-wide. All three follow the source on every run.
- `replace_events` adds what is missing, rewrites what changed and removes what is gone, matched
  by `uid`. A run with nothing changed writes nothing.
- `replace_assignments` replaces who the calendar is assigned to. Someone the source no longer
  names stops seeing it.
- `remove_calendar` deletes a calendar with its events and assignments.

## What a reader sees

- The calendar list, the event grid and the mini month's ticks include the external calendars
  drawn for the reader: those assigned to them and the site-wide ones.
- They are listed under Shared calendars, as a calendar shared read-only is.
- **Shared calendars start unticked**, these and the mail server's alike: a calendar someone
  else keeps is drawn over the reader's own week only once they switch it on. The choice is
  kept per browser, since the mail server lets only a writer change a calendar's visibility.
  It is made in the sidebar, in the calendar's menu, or in the phone's calendar sheet. A
  shared calendar a reader could already see before this change stays drawn.
- A calendar that is switched off is not drawn in the grid and its days are not ticked in the
  mini month. Nothing is drawn until the calendar list has loaded, so a hidden calendar's
  events never flash up first.
- **Search** finds these events beside the mail server's, in the palette and the phone's
  search page: every word typed, in the title, or the notes too unless the title alone is
  asked, within a range where one is given. A range is read as the reader's own days. A
  yearly event answers as its occurrences nearest today and counts as one result. The
  calendar filter can name one of these calendars. Nobody is on them, so a search by
  attendee or organizer finds none.
- **Read-only.** Nothing offers to edit, move, delete or answer one of these events, and none
  of these calendars is offered as a place for a new event.
- Events carry no organizer, participants or alerts, and count as free time.
- **A yearly event** is stored once and drawn in every year a view reaches, from the year it
  starts. One on 29 February falls on the 28th in a year without that day.
- Only the calendar app shows them. The upcoming lists in Mail and Meet do not.

## Security

- **Nothing is read by permission.** The rows can hold names and birth dates, so Suite User has
  no read on the three doctypes. A reader gets them through the calendar API, filtered by
  assignment and site-wide, and by no other route.
- System Manager can read and edit the doctypes in Desk.
- A calendar is found by its source and key, never by name.

## Out of scope

- Any source, including Frappe HR.
- Assigning a calendar to a mail domain. The site has no record of domains; a source that
  wants this resolves the users itself.
