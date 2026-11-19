# HR Calendar Sync

Status: accepted

Scope: the first source for the external calendars in `001-external-calendars.md`. Frappe HR
knows when the office is closed and when people were born or joined. This sync puts that on
calendars this site keeps, and an administrator decides who sees each one.

## What it makes

- **One calendar per holiday list** in HR, named as the list is. A holiday is an all-day event.
  Weekly offs are left out: a weekend is not news.
- **Birthdays**, one calendar, and **Work anniversaries**, another. Each has its own switch, and
  both are off until an administrator turns them on. Each event repeats yearly, as in
  `001-external-calendars.md`, and carries no year. An anniversary starts at the first one, a
  year after the day the employee joined.
- Every event has a `uid` made from its HR record: `hr-holiday-<list>-<date>`,
  `hr-birthday-<employee>`, `hr-anniversary-<employee>`. So a run adds what is missing, rewrites
  what changed and removes what HR no longer has. A run with nothing changed writes nothing.
- Birthdays and anniversaries are for active employees only. Someone who leaves drops off on the
  next run.

## Who sees them

The sync decides what is on a calendar. An administrator decides who sees it.

- A calendar the sync makes is drawn for nobody until an administrator makes it site-wide or
  assigns it to users. The sync never changes either.
- **Holiday calendars start ticked**, so a reader sees the office is closed without looking for
  the calendar. **Birthdays and Work anniversaries start unticked**: across a company there is
  one most days. A reader's own choice still wins.
- HR's Holiday List Assignments are not read. Taking the audience from HR needs to know which
  user here an employee is, and an HR address is often not the one used here (`erpnext.com` in
  HR, `frappe.io` here). That link is a later spec.

## What a run keeps and removes

- **A holiday list that HR no longer returns keeps its calendar**, with its last holidays and its
  audience, and is no longer updated. Last Sync names it. An administrator deletes it when it
  should go. A list can drop out of HR's answer without being deleted (the key loses read on it,
  or it is renamed), and removing it would throw away who it was assigned to.
- **Holidays switched off** keeps every holiday calendar the same way, no longer updated, and
  Last Sync names each.
- **Inside a list,** a holiday that HR no longer has is removed.
- **Birthdays or Work anniversaries switched off** removes that calendar, with its events and its
  audience, as soon as the settings are saved. It does not wait for a run, which needs HR.
- The settings name and colour the calendars: changed there, the change reaches the calendar on
  the next run.

## When it runs

Every hour, once **Enabled** is on. **Sync Now** runs it once, whether or not it is enabled, so
that a site can try it before switching it on. One run at a time, held by a lock.

## Where HR is

HR is read from another site, over its REST API, with an API key and secret of one integration
user there. That user reads Employee and Holiday List, and nothing else. A key of a person's
would stop working when they leave.

Only the HR reader knows where HR is. The rest of the sync takes rows of employees and holidays.

## Security

- **Who:** the settings, Test Connection and Sync Now need write on HR Calendar Sync Settings
  (System Manager). Both buttons act on the saved settings, never on values sent with the
  request.
- **The key and secret** are Password fields. A new HR site URL needs both typed again, so a
  saved key is never sent to an address it was not made for.
- **What a failure records.** Frappe writes a failing job's traceback to the Error Log with the
  local variables of every frame, and those hold the key and employees' names and birth dates.
  The run and Test Connection each catch every failure, roll back, record the traceback without
  variables, and raise a plain error. A failed run leaves nothing half-written.
- **The HR site is somebody else's server.** The URL must be https (http only for localhost), the
  site alone (no path, query, fragment or credentials). Redirects are not followed. An answer
  over 25 MB is refused. Lists are read page by page until a page comes back empty, so a site
  that caps its pages does not cut the roster short.
- **Birth dates are personal.** Birthdays are off by default and show day and month only.
- What remains by design: what HR sends is taken as HR's word, short of dates that are not
  dates, which are skipped. The HR URL is any host an administrator names, so Test Connection
  tells an administrator whether this server reaches it and what status it answers, never what
  it answers.

## Setup

1. On the HR site, an integration user with read on Employee and Holiday List, and an API key and
   secret of its own.
2. **HR Calendar Sync Settings** (Desk): the HR site URL, the key and secret, and what to sync.
   **Test Connection** reports what the key can see: employees, how many have a birth date and a
   joining date, and the holiday lists, with any named in the filter that HR does not have.
3. **Sync Now**, then assign each calendar in **External Calendar**: Site-wide, or users.
4. Switch **Enabled** on.

## Out of scope

- Who sees a calendar, taken from HR's assignments (after the employee link).
- Leave, which belongs on each person's own calendar on the mail server, so that it counts as
  busy.
- A per-person opt-out from Birthdays.
- A Calendar section in Suite Admin for these settings (the next PR). Until then, Desk.
- Writing back to HR.
