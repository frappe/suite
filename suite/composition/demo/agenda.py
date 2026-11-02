"""Northwind calendar: recurring rituals, launch meetings and a few personal events.

Times are local to the site's time zone. A day is (week, weekday): week 0 is the week the seed
runs, -1 the one before; weekday 0 is Monday. Attendee statuses are what each participant has
answered so far; NEEDS-ACTION leaves an open invitation in their inbox.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

ACCEPTED = "ACCEPTED"
DECLINED = "DECLINED"
TENTATIVE = "TENTATIVE"
PENDING = "NEEDS-ACTION"
WEEKDAYS = "MO,TU,WE,TH,FR"


@dataclass(frozen=True)
class Event:
    key: str
    title: str
    organizer: str
    week: int
    weekday: int
    time: str
    duration: str
    attendees: dict[str, str] = field(default_factory=dict)
    rule: str | None = None
    location: str | None = None
    description: str = ""
    all_day: bool = False

    @property
    def uid(self) -> str:
        return f"{self.key}@northwind.test"

    @property
    def participants(self) -> list[str]:
        return [self.organizer, *self.attendees]

    def start(self, monday: date) -> datetime:
        day = monday + timedelta(weeks=self.week, days=self.weekday)
        hour, minute = (int(part) for part in self.time.split(":"))
        return datetime(day.year, day.month, day.day, hour, minute)


def everyone_but(organizer: str, **answers: str) -> dict[str, str]:
    names = ("maya", "leo", "arjun", "nisha", "theo", "sofia")
    return {name: answers.get(name, ACCEPTED) for name in names if name != organizer}


EVENTS = (
    Event(
        "standup",
        "Beacon standup",
        "arjun",
        -3,
        0,
        "10:00",
        "PT15M",
        {"maya": ACCEPTED, "leo": ACCEPTED, "nisha": ACCEPTED},
        rule=f"FREQ=WEEKLY;BYDAY={WEEKDAYS}",
        location="Meet: beacon-standup",
        description="Yesterday, today, blockers. Keep it under 15 minutes.",
    ),
    Event(
        "team-sync",
        "Weekly team sync",
        "maya",
        -3,
        0,
        "11:30",
        "PT45M",
        everyone_but("maya"),
        rule="FREQ=WEEKLY;BYDAY=MO",
        description="Company priorities for the week, then one update per team.",
    ),
    Event(
        "maya-leo",
        "Maya / Leo 1:1",
        "maya",
        -3,
        2,
        "15:00",
        "PT30M",
        {"leo": ACCEPTED},
        rule="FREQ=WEEKLY;BYDAY=WE",
    ),
    Event(
        "arjun-nisha",
        "Arjun / Nisha 1:1",
        "arjun",
        -3,
        3,
        "11:30",
        "PT30M",
        {"nisha": ACCEPTED},
        rule="FREQ=WEEKLY;BYDAY=TH",
    ),
    Event(
        "maya-theo",
        "Maya / Theo 1:1",
        "maya",
        -2,
        4,
        "12:00",
        "PT30M",
        {"theo": ACCEPTED},
        rule="FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    ),
    Event(
        "design-critique",
        "Design critique",
        "leo",
        -3,
        1,
        "16:00",
        "PT1H",
        {"maya": ACCEPTED, "arjun": ACCEPTED, "theo": TENTATIVE},
        rule="FREQ=WEEKLY;BYDAY=TU",
        description="Bring work in progress. Screens on the wall, no slides.",
    ),
    Event(
        "expense-review",
        "September expenses review",
        "sofia",
        -1,
        4,
        "14:00",
        "PT30M",
        {"nisha": ACCEPTED},
    ),
    Event(
        "launch-readiness",
        "Launch readiness",
        "maya",
        0,
        0,
        "15:00",
        "PT1H",
        everyone_but("maya"),
        location="Meeting room Harbor",
        description="Go or no-go for the 2 November private beta. Notes go in Product / Beacon.",
    ),
    Event(
        "csv-pairing",
        "CSV import fix: pairing",
        "arjun",
        0,
        2,
        "14:00",
        "PT1H",
        {"nisha": ACCEPTED},
    ),
    Event(
        "hiring-review",
        "Hiring review: senior frontend engineer",
        "arjun",
        0,
        3,
        "12:00",
        "PT1H",
        {"maya": ACCEPTED, "leo": PENDING, "sofia": ACCEPTED},
        description="Shortlist decision. Portfolio feedback in the hiring tracker beforehand.",
    ),
    Event(
        "launch-check-in",
        "Launch check-in",
        "maya",
        0,
        3,
        "15:00",
        "PT30M",
        {"leo": ACCEPTED, "arjun": ACCEPTED, "theo": ACCEPTED, "sofia": DECLINED},
        description="Post updates in the launch folder before the meeting.",
    ),
    Event(
        "all-hands",
        "Company all-hands: Q3 review and Q4 priorities",
        "maya",
        0,
        4,
        "17:00",
        "PT1H",
        everyone_but("maya", nisha=PENDING, theo=TENTATIVE),
        location="Meeting room Lighthouse and Meet",
        description="Sofia walks through Q3 numbers, then each team shares one Q4 priority.",
    ),
    Event(
        "budget-review",
        "Q4 budget review",
        "sofia",
        1,
        0,
        "14:00",
        "PT1H",
        {"maya": ACCEPTED, "theo": PENDING, "arjun": TENTATIVE},
        description="Final pass on the Q4 operating budget before it is locked.",
    ),
    Event(
        "study-retest",
        "Collections retest: share position",
        "leo",
        1,
        1,
        "11:00",
        "PT1H",
        {"maya": PENDING},
        description="Two participants, 25 minutes each. Observers welcome; cameras off.",
    ),
    Event(
        "office-hours-rehearsal",
        "Office hours rehearsal",
        "arjun",
        1,
        2,
        "16:00",
        "PT30M",
        {"leo": ACCEPTED},
    ),
    Event(
        "beta-launch",
        "Collections private beta opens",
        "theo",
        2,
        0,
        "00:00",
        "P1D",
        everyone_but("theo", sofia=PENDING, nisha=PENDING),
        all_day=True,
        description="Invitations go to the 12 beta customers at 09:00.",
    ),
    Event("maya-focus", "Focus: launch checklist", "maya", 0, 2, "09:00", "PT2H"),
    Event("maya-dentist", "Dentist", "maya", 1, 1, "18:00", "PT1H"),
    Event("leo-gym", "Gym", "leo", -2, 0, "07:30", "PT1H", rule="FREQ=WEEKLY;BYDAY=MO,TH"),
    Event("leo-portfolios", "Review candidate portfolios", "leo", 0, 2, "14:00", "PT2H"),
    Event("arjun-deep-work", "Deep work: import pipeline", "arjun", 0, 4, "09:00", "PT3H"),
    Event(
        "nisha-spanish",
        "Spanish class",
        "nisha",
        -2,
        1,
        "19:00",
        "PT1H",
        rule="FREQ=WEEKLY;BYDAY=TU",
    ),
    Event("theo-podcast", "Podcast recording: Product Weekly", "theo", 1, 3, "17:00", "PT1H"),
    Event("sofia-payroll", "Payroll run", "sofia", 1, 2, "10:00", "PT1H"),
    Event("sofia-close", "Month-end close", "sofia", 1, 4, "00:00", "P1D", all_day=True),
)
