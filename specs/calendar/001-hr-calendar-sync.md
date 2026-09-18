# HR Calendar Sync

Status: accepted

Frappe HR knows when the office is closed and when people joined or were born. Suite's calendar
did not, so everyone read that from emails and a wiki page. This syncs it: a calendar per holiday
list, and an optional company-wide Celebrations calendar for birthdays and work anniversaries, kept
in step with HR.

## Behaviour

- A **service account** on the mail server owns the calendars. It is shared read-only with the
  employees each calendar is about, so the events show up under Shared Calendars without anyone
  switching accounts, and nobody can change them (see the read-only rights work in the calendar).
- **Holidays** are all-day and free. Weekly offs are not synced: a weekend is not news.
- **Birthdays and work anniversaries** share one **Celebrations** calendar — the same people see
  both, and the titles tell them apart — each with a switch of its own; switching one off removes
  its events. They repeat yearly and carry no year. A 29 February birthday
  falls on the 28th in years without one. An anniversary starts at the first one; the years served
  are not in the title, because every occurrence of a repeating event shares one title.
- Events carry **no organizer and no participants**. They are facts about a day, not invitations,
  which is how every other calendar draws a holiday.
- **Who sees a holiday list** is who HR says follows it, asked the way HR resolves it: by the
  submitted **Holiday List Assignment**, the employee's own, else their company's — the one in
  force today, and any already assigned to follow it, so next year's list is on the calendar
  before the year turns. The holiday list on an employee and the default on a company are fields
  Frappe HR no longer reads, and neither does the sync: it needs Frappe HR 16 or later.
  Celebrations go to every active employee of the company.
- Each event carries a **uid built from its HR record** (`hr-holiday-<list>-<date>`,
  `hr-birthday-<employee>`, `hr-anniversary-<employee>`). A run therefore adds what is missing,
  rewrites what changed, and removes what HR no longer has — including for an employee who left.
  An event without such a uid was put on the calendar by hand and is left alone.
- The **share is replaced** on every run, so someone who leaves loses the calendar. An address the
  mail server does not know is skipped: not everyone in HR has a mailbox here.
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
- **Only the sync's own calendars.** The ones it made are remembered by id in the settings, and it
  reuses a calendar only from there. A calendar's name comes from HR, so a name is never how one
  is found: a calendar already in the account that happens to share it is left alone, not adopted
  and shared.
- **The settings and HR name and colour them.** A calendar the sync made is kept to the name and
  colour it would be given today — a holiday list renamed in HR, a colour or the Celebrations name
  changed in the settings — on every run, not only the day it was made. A name given to it by hand
  in the calendar is therefore put back.
- **Only the sync's own events** (`hr-holiday-`, `hr-birthday-`, `hr-anniversary-` uids) are ever
  rewritten or removed; two synced calendars may not share a name.
- **A share goes only to a person HR named:** an address must match exactly, and a group is never
  shared with, since that would reach everyone in it.
- **Celebrations stay within a company:** with several companies on one HR site, each gets its own
  Celebrations calendar, as HR's own reminders do.
- **One run at a time**, held by a lock, whoever starts it.
- What remains by design: anyone who can edit HR's employee records can give an address read
  access to that employee's holiday calendar; and what HR sends is taken as HR's word, short of
  dates that are not dates, which are skipped.

## Setup

1. **A service account on the mail server.** An individual account nobody logs in as, e.g.
   `hr-calendars@example.com`, with an app password. Not a group: a group's members get write
   access to its calendars, which would let anyone edit the holidays. The settings refuse an
   account that is not its owner's own login — a group, or a mailbox only shared with them.
2. **A user on the Suite site for that account**, with its mail credentials, so the sync can
   reach it.
3. **Read access to HR.** Where Frappe HR is on another site, an integration user there with read
   access to Employee, Holiday List and Holiday List Assignment, and an API key and secret of its
   own — not a person's, so the sync does not stop when they leave. Where HR is on the same site,
   nothing is needed.
4. **HR Calendar Sync Settings** (Desk): the service account, the HR site URL and keys, and what to
   sync. **Test Connection** reports what the keys can see — employees, birth dates, joining dates,
   mail addresses, holiday lists — before anything is written; **Sync Now** runs it once.
5. Switch **Enabled** on. From then it runs daily.

Birth dates are personal: birthdays are off by default, and a site turns them on only where
everyone expects the whole company to see them.

## Out of scope

- Writing back to HR. The sync is one-way.
- Leave, interviews and training. Leave belongs in the employee's own calendar and the rest are
  invitations to the people involved; both need more than a shared calendar (a later spec).
- Shift assignments, attendance, salary slips, and HR's own reminder emails.
