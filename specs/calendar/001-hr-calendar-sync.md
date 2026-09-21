# HR Calendar Sync

Status: accepted

Frappe HR knows when the office is closed and when people joined or were born. Suite's calendar
did not, so everyone read that from emails and a wiki page. This syncs it: a calendar per holiday
list, and an optional company-wide Celebrations calendar for birthdays and work anniversaries, kept
in step with HR.

## Where the calendars live

They are held by this site, not by the mail server, in **External Calendar** and the events and
audience beside it.

A calendar on the mail server is seen by the people it is shared with, and a holiday calendar is
about everyone in a company. Stalwart caps sharees per calendar — `maxShares`, ten by default —
so an audience of a few thousand is not something to ask a mail server for. Held here, an audience
is a row per person, which a database does not notice, and resolving who sees what is one query
rather than a directory lookup per fifty people.

The store knows nothing about HR. A source states what its calendars are called, what is on them
and who they are for; **Frappe HR** is the first, and another is expected to be the second.

What this costs: these events reach Suite's calendar and nothing else. They are not on the mail
server, so they do not appear in Apple Calendar, Thunderbird or any other CalDAV client. Holidays
that have to show up there belong in a calendar of their own, subscribed to.

## Behaviour

- **Holidays** are all-day and free. Weekly offs are not synced: a weekend is not news.
- **Birthdays and work anniversaries** share one **Celebrations** calendar — the same people see
  both, and the titles tell them apart — each with a switch of its own; switching one off removes
  its events. They repeat yearly and carry no year: the day is stored once and drawn in every year
  a view reaches. A 29 February birthday falls on the 28th in years without one. An anniversary
  starts at the first one; the years served are not in the title, because every occurrence of a
  repeating event shares one title.
- **Celebrations start out unticked**: a birthday or an anniversary most days is more than most
  people want drawn over their own week, so it is theirs to switch on, in the sidebar or from the
  calendar's menu, per browser. Holiday calendars start shown.
- **Read-only.** Nobody can edit or delete these events in the calendar, and nothing is offered
  that would try: what they say is HR's to change.
- Events carry **no organizer and no participants**. They are facts about a day, not invitations,
  which is how every other calendar draws a holiday.
- **Who sees a holiday list** is who HR says follows it, asked the way HR resolves it: by the
  submitted **Holiday List Assignment**, the employee's own, else their company's — the one in
  force today, and any already assigned to follow it, so next year's list is on the calendar
  before the year turns. The holiday list on an employee and the default on a company are fields
  Frappe HR no longer reads, and neither does the sync: it needs Frappe HR 16 or later.
  Celebrations go to every active employee of the company.
- **An employee is a user of this site**, found by the address HR knows them by. One this site has
  never heard of is left out: there is nobody here to draw a calendar for. A mailbox is not needed
  — a site user is enough.
- Each event carries a **uid built from its HR record** (`hr-holiday-<list>-<date>`,
  `hr-birthday-<employee>`, `hr-anniversary-<employee>`). A run therefore adds what is missing,
  rewrites what changed, and removes what HR no longer has — including for an employee who left.
- The **audience is replaced** on every run, so someone HR no longer names stops seeing the
  calendar; a holiday list nobody follows any more is removed with its events and its audience.
- A run is **repeatable**: with nothing changed in HR, nothing is written.

## Security

- **Who can run it:** the settings, Test Connection and Sync Now need the right to change the
  settings (System Manager). Both buttons act on what is saved, never on values sent with the
  request.
- **The HR credentials** are Password fields, and never appear as a variable in the sync's frames:
  Frappe writes a failing job's traceback to the Error Log with each frame's contents, and its
  redaction does not cover them. For the same reason the run is wrapped so that employees' names
  and birth dates are in no frame a failure is reported from. Both are under test.
- **The HR site URL** is fetched by this server, so it must be a plain https site (http only for
  localhost): no path, query, fragment or credentials, and redirects are not followed. An answer
  over 25 MB is refused.
- **Nothing is read by permission.** The events hold employees' names and birth dates, so no role
  is granted read on them: they reach a person through the calendar API, filtered by the audience
  rows, and through nothing else.
- **Only the sync's own calendars.** A calendar is found by the source and the key that source
  knows it by, never by name — a name comes from HR and could be any calendar's. One source may
  not keep two calendars for the same key, and two synced calendars may not share a name.
- **The settings and HR name and colour them.** A calendar the sync made is kept to the name and
  colour it would be given today — a holiday list renamed in HR, a colour or the Celebrations name
  changed in the settings — on every run, not only the day it was made.
- **A failed run leaves nothing behind.** Everything it wrote is in this database and rolls back
  with it; what went wrong is recorded in one commit of its own, without variables.
- **Celebrations stay within a company:** with several companies on one HR site, each gets its own
  Celebrations calendar, as HR's own reminders do.
- **One run at a time**, held by a lock, whoever starts it.
- What remains by design: anyone who can edit HR's employee records can put an address in an
  audience; and what HR sends is taken as HR's word, short of dates that are not dates, which are
  skipped.

## Setup

1. **Read access to HR.** Where Frappe HR is on another site, an integration user there with read
   access to Employee, Holiday List and Holiday List Assignment, and an API key and secret of its
   own — not a person's, so the sync does not stop when they leave. Where HR is on the same site,
   nothing is needed.
2. **HR Calendar Sync Settings** (Desk): the HR site URL and keys, and what to sync.
   **Test Connection** reports what the keys can see — employees, birth dates, joining dates, how
   many of them this site knows, holiday lists — before anything is written; **Sync Now** runs it
   once.
3. Switch **Enabled** on. From then it runs daily.

Birth dates are personal: birthdays are off by default, and a site turns them on only where
everyone expects the whole company to see them.

## Out of scope

- Writing back to HR. The sync is one-way.
- Leave, interviews and training. Leave belongs in the employee's own calendar and the rest are
  invitations to the people involved; both need more than a read-only calendar (a later spec).
- Shift assignments, attendance, salary slips, and HR's own reminder emails.
- Putting these events on the mail server, and so in other calendar clients.
