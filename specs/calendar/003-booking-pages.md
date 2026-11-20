# Booking Pages

Status: accepted

Scope: a public page where someone outside the company picks a free time with a host, answers
a few questions and gets an invitation. v1 serves one host per page. The model leaves room for
team pages, which come later. Booking pages follow the busy rules of
[Availability](002-availability.md).

## The page

- A **Booking Page** is kept on the site. The mail server has nothing for it.
- A page has a list of **hosts**. Each host is a user and the calendar their bookings go to.
  v1 allows exactly one host per page.
- Only a page's hosts can change it. A team admin comes later.
- A host makes and changes their pages in Calendar's settings, on the desktop and on the
  phone. Each page can be switched off, and its link can be copied from there.

## The link

- A page is at `/book/<slug>`, for example `suite.frappe.io/book/akash-onboarding`. The slug is
  unique on the site and names no person, so a team page later takes a slug in the same space.
- The host picks the slug. It starts from the page's title.
- A changed slug breaks the old link. The settings say so before the change is saved.
- The page works without signing in. A page that is switched off answers as one that does not
  exist.

## Settings

- **Title** and a short **description**, shown to the booker with the host's name and photo.
- **Length**: one per page, for example 60 minutes. Letting the booker pick from several comes
  later.
- **Slots start** every N minutes within the weekly hours. N starts equal to the length, so a
  60-minute page offers 9:00, 10:00 and 11:00. The other choices are 15 and 30.
- **Buffer**: a slot is offered only when the host is also free for this many minutes before
  and after it. Any busy time counts, not only other bookings. It starts at 0.
- **Minimum notice**: no slot starts sooner than this from now. It starts at 4 hours.
- **How far ahead**: no slot starts more than this many days from today. It starts at 30 days.
- **Weekly hours**: one or more time ranges per weekday, for example Monday 9:00–12:00 and
  14:00–18:00. They start as Monday to Friday, 9:00–17:00.
- **Time zone** of the weekly hours. It starts as the host's. Minimum notice and how far ahead
  count days in this zone too.
- **No bookings on holidays**, on by default. See [Free time](#free-time).
- **Verify the booker's email**, off by default. See [Abuse](#abuse).
- Hours for one date, or a day off, come later. Until then a host takes a day off with a Busy
  all-day event.

## Free time

- Free slots are worked out on the server from the page's hosts and a rule for combining them.
  v1 has one rule, "every host is free", and one host. Team rules come later.
- A host's busy time comes from the mail server (`Principal/getAvailability`), the call that
  team pages will need for colleagues' time too. It must follow the busy rules of
  [Availability](002-availability.md): free, cancelled and declined events do not count, each
  calendar's "include in availability" is followed, calendars shared with the host are not
  theirs, an all-day event runs to the start of the next day, and events that only touch do not
  overlap. The first slice checks this against the mail server. If the server gets a rule
  wrong, Suite applies these rules to the host's events itself instead.
- The mail server tells nothing about busy time beyond start and end, so a page cannot show
  what the host is doing.
- **No bookings on holidays**: a page picks times for its host, so unlike the event form it
  treats holidays as days off. A day on a holiday calendar the host can see offers no slots.
  A source of site calendars says which of its calendars are days off. Birthday calendars never
  block. The host can turn this off for a page.
- A slot is offered when it lies inside the weekly hours, starts on the page's grid, meets the
  minimum notice and how far ahead, and every host is free for it with the buffer on each side.

## The booker's time zone

- Slots are shown in the zone of the booker's browser. The page names the zone above the slots,
  and the booker can pick another.
- The booker's email and their reschedule page use the zone they booked in.

## Questions

- Every booker gives their **name** and **email**.
- **Phone** is asked by default and is optional. The host can make it required or take it off.
- The host adds their own questions, each short text or long text, and each required or not.
  A Frappe Cloud site URL is a short-text question. Choice lists and checkboxes come later.

## Where

- **A new Meet room for each booking**, the default, or **one Meet room** the host picks. With
  one room, everyone who ever booked keeps a link that works for later calls too, so the
  settings say so.
- Other places (another video link, a phone call, an address) come later.

## A booking

- Each booking is kept on the site as a **Booking**: the page, the host it went to, the
  booker's name and email, their answers, the time and zone they booked in, the event it made
  on the host's calendar, and whether it is booked or cancelled.
- Before a booking is made, the slot is checked again while no other booking of the same hosts
  can be made, so two people cannot take one slot.
- A booking puts an event on the host's calendar: "<page title> with <booker's name>", the
  answers in its notes, the booker as a guest who has accepted, and the Meet link.
- Suite, not the mail server, sends the booker one email from the host's address: the page's
  title, the time in the booker's zone, the Meet link, the Reschedule and Cancel links, and an
  `.ics`. **Nothing the booker typed is in it**, so the form cannot be used to send someone
  else mail from the host's address. Only the page and the time go in.
- The host gets a "New booking" email with the booker's name, email and answers.
- The event is the truth for the time. When the host moves the event in Calendar, the booking
  shows the new time. When the host deletes it, the booking shows as cancelled.
- What the host changes later in Calendar goes out the way any change of theirs does. That
  update carries the event's notes, and so the answers, to the booker.

## Reschedule and cancel

- The booker's email carries a signed link to their booking. The page there shows the booking
  with **Cancel** and **Pick another time**.
- Pick another time offers the page's free slots and moves the same event. The booking's own
  time does not count as busy while it is being moved.
- Cancel takes an optional reason. It cancels the event.
- Both work until the minimum notice before the start. After that the page says to contact the
  host.
- The host gets an email for either, with the reason when one is given. The booker gets the
  moved or cancelled invitation.
- A link stops working once the booking has started or is cancelled.

## Abuse

The page is public and sends mail, so it is limited. Google, Calendly and Cal.com do much the
same: limits and bot checks for everyone, and an emailed code the host can ask for.

- Slot lookups and bookings are rate limited per IP address.
- One email holds at most 2 upcoming bookings on a page.
- The form has a hidden field that people do not fill in. A booking that fills it is dropped as
  if it were made.
- **Verify the booker's email**: when it is on, the booker types a 6-digit code mailed to them,
  and only then is the booking made. The code mail carries nothing the booker typed. Codes are
  rate limited per address and per IP address.
- At worst, someone books a fake slot and the host cancels it.

## Later

Not in version one:

- Team pages: more than one host, round robin and other rules for combining hosts, colleagues'
  busy time (needs the company free/busy share, frappe/suite#1297), and a team admin.
- Routing by answers, and payments.
- Several lengths per page, hours for one date, a cap on bookings per day.
- Other places to meet, and choice questions.
- A CAPTCHA, and a blocklist of emails and domains.
- Reminders to the booker, and putting a page on another website.
- An old slug that still leads to its page.
