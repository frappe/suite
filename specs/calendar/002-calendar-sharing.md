# Calendar Sharing

Status: proposed

Someone who keeps a calendar often needs one other person to see it — a manager's week, a
team's on-call rota, the calendar an assistant works from. Today the only way is for an
administrator to grant it on the mail server, so nobody does it. This puts it in the calendar
app: a calendar's owner names who sees it, and how much.

## What sharing is here

It is the **mail server's own sharing** — JMAP's `shareWith` on the calendar — not a Suite-side
audience. So a calendar shared here is shared everywhere the reader opens their mail account:
Apple Calendar and Thunderbird included, not Suite alone.

It is addressed to a **principal on this mail server**, an individual or a group, never a bare
address. `shareWith` is keyed by principal, and a principal is what the server can resolve
rights against; someone the server has never heard of cannot be shared with, and the thing to
do with them is invite them to an event.

There is **no link and no "anyone with the address"**. JMAP has no such thing for a calendar, so
the general-access half of a Drive or Sheets share dialog has no meaning here and is absent.

## What a reader gets

One thing: **every event on the calendar** (`mayReadFreeBusy` and `mayReadItems`). It does not
grant the right to share the calendar on — a reader cannot widen the audience the owner chose —
and write access is out of scope, below.

JMAP has a narrower grant, free/busy: the reader sees that time is taken and nothing about what
takes it, and it is what `Principal/getAvailability` — "is this person busy at three?" — is
answered from. It is not offered, because on Stalwart it grants nothing anyone can see: the
calendar is not listed to the reader, no events are sent, and the availability lookup returns an
empty list even to the calendar's owner (measured, with a plain busy event). It comes back the
day the lookup works; a free/busy grant made from another client reads back as Custom meanwhile.

A calendar may already carry rights no role here describes — granted by another CalDAV client,
or by an administrator. Those read back as **Custom**: shown, named as a person and the rights
they hold, and left exactly as they are. Saving a role for one sharee never rewrites another's,
and this dialog never silently narrows what another client granted.

## Behaviour

- **Who may share** a calendar is the mail server's answer, not this app's: the right it reports
  on the calendar. Stalwart calls it `mayShare`; the JMAP calendars draft calls it `mayAdmin`.
  Both are read, so the app is right on either server, and a calendar that reports neither
  offers no sharing.
- **Sharing is per calendar.** Sharing one says nothing about the others in the account.
- **A sharee sees it among their own calendars**, read-only, alongside the ones they keep — they
  do not switch accounts to reach it. Which accounts to look in, and which a user may reach at
  all, is the mail server's answer: its session, asked afresh rather than read from the copy
  this site keeps, which is refreshed only after a request has been made against it. A reader
  reaches the owner's account as themselves, with the rights the server gave them. They are not
  linked to it as a member: the User Account rows say who is a member of an account, and a
  reader is not one.
- **A share reaches its reader at once.** Sharing a calendar, or taking it away, drops the
  list this site keeps for each person it was shared with; a group's members find out when
  their list next expires, a few minutes on.
- **A calendar arrives unnamed, and is named anyway.** Stalwart withholds a calendar's name from
  a reader who may not write it, so the app reads the name as the calendar's owner and shows it —
  the row says "trest", not the address it came from. Where that fails it says whose it is.
- **A reader may not share it on**, and is shown no sharees: the server tells them nothing about
  who else holds it.
- **Unsharing** takes it off the sharee's list, along with its events.
- **A group** is shared with as one sharee. Who that reaches is the server's to resolve, and it
  changes as the group's membership does, without the calendar being touched again.
- **The cap is the server's.** Stalwart caps sharees per calendar — `maxShares`, ten by default
  — and does not advertise the number in its session, so nothing here counts sharees or greys
  out a picker at ten. A refusal is shown as the server words it, at the moment it happens.
- **Who a calendar is shared with is the owner's to know.** The server returns no sharee list on
  a calendar shared *into* an account, so a reader cannot enumerate the others who hold it.

## Security

- **Checked on the server.** Every share is written through a right the mail server reports on
  that calendar, read fresh; never on a claim carried in the request.
- **A share is the whole calendar.** There is no per-event exception, and a calendar with
  anything on it not meant for a reader is a calendar not to share. The dialog says so, once,
  above the list.
- **The people search is the server's, and bounded.** Matches come from the mail server's own
  principal query, so it offers what this account is already allowed to see — a screenful at
  most, for a query of at least two characters, rate-limited like every write — and does not
  turn the calendar app into a directory of its own.
- **A reader's name for the calendar is read as its owner.** Stalwart withholds a calendar's
  name from anyone who may not write it, so the name is read over the owner's connection —
  only for calendars the reader was already handed, kept a few minutes, and for a team account,
  which has no owner, as one of at most two members.
- **What remains by design:** the mail server's own reconciliation still links a reader to the
  owner's account as a member on their next request, as it links every account a session
  lists — the session says nothing about how much of an account somebody holds. Nothing here
  needs that link, and a new account that is not the user's own is no longer provisioned with
  an archive folder and a sieve script on their behalf; telling members from readers in those
  rows is a change to the mail app of its own.

## Out of scope

- **Write access.** A calendar a reader can write to is, in this app, an account they work in,
  reached through the account switcher rather than their own sidebar — which is how a calendar
  shared with them is told apart from one of their own. Offering edit rights means changing that
  premise and deciding where such a calendar belongs; it is a decision of its own, not a third
  entry in a role list.
- **A reader removing a calendar from their own list.** Nothing on a Stalwart calendar is per
  user: its name, colour, visibility and subscription are one copy that everybody shares, so a
  reader unsubscribing would unsubscribe its owner. The right that would let them write those
  properties, `mayUpdatePrivate`, lets them rename and hide the calendar for its owner too, so
  no role here grants it. A removal would therefore have to be a record this site keeps, which
  is a decision of its own; until then, unsharing is the owner's and hiding is the reader's.
- **Delegating a whole account**, rooms and resources, and per-event privacy.
