---
label: wayfinder:map
tracker: local-markdown
---

# Map: Booking pages in Calendar

## Destination

Booking pages in Suite Calendar (frappe/suite#1263): a public page where someone outside the
company books a free time with a host. Version one serves one host per page and is specified in
[specs/calendar/003-booking-pages.md](../../specs/calendar/003-booking-pages.md). Everything
after it is a ticket here, decided before it is built.

## Notes

- Tickets are picked by priority, together with the user, not in the order below.
- Ask one question at a time.
- The spec is the contract. A ticket that closes changes the spec, or adds one beside it.
- Each ticket that closes is split into PR-sized slices. Each slice is built in its own session
  off `forge/drive-layer` and opened as a PR to frappe/suite.
- Every slice with UI is designed and checked at phone width in the same PR, and uses
  frappe-ui.

## Building version one

One PR per slice, in this order. Slice 1 is next.

1. **Free slots on the server.** The Booking Page with its hosts (one allowed) and the settings
   that shape slots: length, slot starts, buffer, minimum notice, how far ahead, weekly hours
   and their time zone. The free-slot function, which takes hosts and a combining rule. The
   check that the mail server's busy time follows the rules of the availability spec, and
   Suite's own rules in its place if it does not. A rate-limited public endpoint that returns a
   page's slots. No UI: a page is made in Desk.
2. **The public page.** `/book/<slug>` without signing in: the title, the host, the days and
   slots, in the booker's zone with a zone picker. Not found for a page that is off.
3. **Booking.** Name and email, the Booking record, the re-check under a hold, the event on the
   host's calendar, the booker's email with its `.ics`, the host's email, the per-IP and
   per-email limits and the hidden field.
4. **Settings in Calendar.** Making and changing pages in Calendar's settings, on the desktop
   and the phone: slug, copy link, on and off.
5. **Questions.** Phone, and the host's short-text and long-text questions; answers in the
   event's notes and the host's email.
6. **Meet.** A new room for each booking, or one room the host picks.
7. **Reschedule and cancel.** The signed link, its page, the cutoff, and the mail to both.
8. **Holidays.** No bookings on holidays. It needs a source of site calendars to say which of
   its calendars are days off, so it follows the HR calendar sync.
9. **Verify the booker's email.** The emailed code, behind the page's switch.

After slice 3 the user can take real bookings on a page made in Desk. After slice 7 it replaces
their Google booking page.

## Decisions so far

- [Booking pages, version one](tickets/001-booking-pages-v1.md): a page on the site with a list
  of hosts (one for now) at `/book/<slug>`; busy time from the mail server; a Booking record
  per booking with its host; the booker's mail carries nothing they typed; limits plus an
  optional emailed code.

## Not yet specified

- [Team pages: several hosts and how they combine](tickets/002-team-pages.md), blocked by 003
- [A page that reads colleagues' busy time](tickets/003-colleagues-busy-time.md), blocked on
  frappe/suite#1297
- [Who runs a team page](tickets/004-team-admin.md), blocked by 002
- [Routing by answers](tickets/005-routing-by-answers.md), blocked by 002
- [Paying for a booking](tickets/006-payments.md)
- [Several lengths on one page](tickets/007-several-lengths.md)
- [Hours for one date, and days off](tickets/008-dated-hours.md)
- [A cap on bookings per day](tickets/009-bookings-per-day.md)
- [Other places to meet](tickets/010-other-places.md)
- [Choice questions](tickets/011-choice-questions.md)
- [A CAPTCHA on the booking form](tickets/012-captcha.md)
- [Blocking emails and domains](tickets/013-blocklist.md)
- [Reminders to the booker](tickets/014-reminders.md)
- [A booking page on another website](tickets/015-embed.md)
- [An old slug that still leads to its page](tickets/016-old-slugs.md)
- [The host's list of bookings](tickets/017-bookings-list.md)
