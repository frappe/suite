# Availability

Status: accepted

Scope: what the event form tells its writer about time that is already taken, theirs and the
people they invite. Booking pages build on this and have their own spec.

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

## Whether the people invited are free

Each person invited who has an account on the same mail server shows **Busy** beside their
name in the form when they are busy at any point of the event's time. Nothing is shown
otherwise.

- What is busy is the mail server's answer, from the calendars each person counts toward
  availability. It holds no titles or details, only times.
- The server tells the writer only about calendars shared with them with the Read
  Free/Busy right, or more. A person who shared nothing answers like a person with an empty
  week, so the form never says "Free": it cannot tell the two apart.
- People on other servers, a Gmail address or another company's, show nothing.
- The writer is not looked up: their own time is the conflict note's.
- At most 20 people are looked up for one event, the mail server's own limit on attendees,
  and for no more than 14 days of the event's time. A longer event looks nobody up.
- The answer is asked again a moment after the time or the list of people stops changing.

## A company's free time

Seeing a colleague's busy time without them sharing anything is how Google Workspace and
Exchange work: each calendar carries one entry for the whole company. Stalwart has no such
entry. A calendar is shared with accounts and groups only, and it refuses "everyone" and
"every signed-in user", over JMAP and CalDAV alike.

The equivalent is one group per company that every account belongs to, with each calendar
shared with it as Read Free/Busy. Making that group and keeping it is a separate change: it
is done through Suite Cloud, and the group appears to each member as an account of its own,
which Mail and Calendar would have to leave out.

## Out of scope

- Suggesting a time that suits everyone.
- Booking pages.
- A warning when accepting an invitation that overlaps.
