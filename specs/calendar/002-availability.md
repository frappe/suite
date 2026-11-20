# Availability

Status: accepted

Scope: what the event form tells its writer about their own time that is already taken.

## Your own conflicts

The event form, on the desktop and on the phone, says under the time when the writer is
already busy then: "Overlaps Standup, 14:30–15:30", and "and 2 more" past the first. The note
changes as the time changes and never stops a save. Moving an event by dragging it says
nothing.

An event makes the writer busy when all of these hold:

- It is on one of the calendars of the account the form writes to. A calendar someone else
  shared with the writer is theirs, not the writer's, and the calendars this site keeps
  (holidays, birthdays) are free time.
- It is not cancelled, and the writer has not declined it.
- Its Availability is Busy. An event that does not say counts as busy, as JMAP reads it.
- Its calendar counts toward availability. A calendar set to count none of its events
  counts none; one set to count only what its owner attends counts the events the writer
  is on, organizer or participant, and those with nobody on them.
- It is not the event being edited, nor another occurrence of it.

Times overlap when one starts before the other ends. Two events that touch, one ending at
10:00 and the next starting then, do not. An all-day event runs from the start of its first
day to the start of the day after its last, in the writer's zone.

A repeating event is checked at the occurrence the form shows, not at every one.

**A new all-day event starts as Free.** A day at a conference or a public holiday is marked
on the calendar without taking the day; a day off is set to Busy. A new timed event starts
as Busy, and switching all-day on and off moves it between the two until the writer picks
one. An event already saved keeps what it has.

## Out of scope

- Whether the people invited are free. The mail server tells one person about another's busy
  time only from calendars shared with them, and there is no share with a whole company, so
  for most people it would answer nothing. It waits on a company-wide share.
- Suggesting a time that suits everyone.
- Booking pages.
- A warning when accepting an invitation that overlaps.
