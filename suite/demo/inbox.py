"""Northwind mail threads, written around the Drive story: the Beacon beta, Q3 numbers and hiring.

People are addressed by their first name in lower case, mailing lists by their local part, and
outside senders by the keys of OUTSIDE. Days count back from the day the seed runs.
"""

from dataclasses import dataclass, field

OUTSIDE = {
    "weekly": ("Product Weekly", "newsletter@productweekly.example"),
    "ledgerly": ("Ledgerly", "billing@ledgerly.example"),
    "codehost": ("Codehost", "notifications@codehost.example"),
    "dana": ("Dana Whitfield", "dana@acmeresearch.example"),
    "brightwave": ("Dana Brooks", "dana@brightwave.example"),
}

NEWSLETTER_HEADERS = {
    "List-Unsubscribe": "<https://productweekly.example/unsubscribe>",
    "List-Id": "Product Weekly <weekly.productweekly.example>",
    "Precedence": "bulk",
}
NOTIFICATION_HEADERS = {"Auto-Submitted": "auto-generated", "Precedence": "bulk"}


@dataclass(frozen=True)
class Attachment:
    name: str
    content_type: str
    lines: tuple[str, ...]


@dataclass(frozen=True)
class Message:
    sender: str
    to: tuple[str, ...]
    days_ago: int
    time: str
    body: str
    cc: tuple[str, ...] = ()
    attachments: tuple[Attachment, ...] = ()


@dataclass(frozen=True)
class Thread:
    key: str
    subject: str
    messages: tuple[Message, ...]
    starred_by: tuple[str, ...] = ()
    headers: dict[str, str] = field(default_factory=dict)


def html(*paragraphs: str) -> str:
    return "".join(f"<p>{paragraph}</p>" for paragraph in paragraphs)


EVERYONE = ("maya", "leo", "arjun", "nisha", "theo", "sofia")

THREADS = (
    Thread(
        "welcome-nisha",
        "Please welcome Nisha to Engineering",
        (
            Message(
                "maya",
                ("team",),
                20,
                "09:15",
                html(
                    "Hi all,",
                    "Nisha Patel joins Arjun's team today as a software engineer. She spent the last "
                    "three years on data import tooling, which is good timing for Beacon.",
                    "Please say hello, and Nisha, the handbook in Drive has everything for your first week.",
                    "Maya",
                ),
            ),
            Message(
                "leo",
                ("team",),
                20,
                "09:42",
                html("Welcome Nisha! Happy to walk you through the design files whenever you like.", "Leo"),
            ),
            Message(
                "sofia",
                ("nisha",),
                20,
                "11:05",
                html(
                    "Welcome aboard, Nisha. Your laptop ships tomorrow. Please send me your bank details "
                    "through the payroll form, not by email.",
                    "Sofia",
                ),
                cc=("maya",),
            ),
            Message(
                "nisha",
                ("team",),
                20,
                "12:30",
                html("Thank you all for the warm welcome. Looking forward to working with you.", "Nisha"),
            ),
        ),
    ),
    Thread(
        "launch-plan",
        "Beacon beta: launch plan for 2 November",
        (
            Message(
                "maya",
                ("team",),
                19,
                "10:00",
                html(
                    "Hi team,",
                    "We are inviting 12 existing customers to the Collections private beta on "
                    "<strong>2 November</strong>. The plan is in Drive under Product / Beacon.",
                    "Owners: Leo for empty states and focus order, Arjun and Nisha for import "
                    "reliability, Theo for invitations and the walkthrough, Sofia for the support budget.",
                    "Please reply with anything that puts the date at risk.",
                    "Maya",
                ),
            ),
            Message(
                "arjun",
                ("maya",),
                18,
                "14:20",
                html(
                    "The only risk I see is CSV import with mixed date formats. Nisha is on it. "
                    "I will know by Friday whether it needs a feature flag.",
                    "Arjun",
                ),
                cc=("team",),
            ),
            Message(
                "theo",
                ("maya",),
                18,
                "16:45",
                html(
                    "Invitation copy will be ready for review next week. I would like the customer list "
                    "approved by the 23rd so we can warm people up before the email.",
                    "Theo",
                ),
                cc=("team",),
            ),
            Message(
                "maya",
                ("team",),
                17,
                "09:30",
                html("Thanks both. Customer list approval is on me. The date stays.", "Maya"),
            ),
        ),
    ),
    Thread(
        "spec-review",
        "Collections spec ready for design review",
        (
            Message(
                "maya",
                ("leo",),
                16,
                "11:10",
                html(
                    "Leo, the Collections specification is ready for your review. A one-page summary "
                    "is attached; the full document is in the Beacon folder.",
                    "Main question for you: is sharing discoverable enough from the collection page?",
                    "Maya",
                ),
                cc=("arjun",),
                attachments=(
                    Attachment(
                        "collections-spec-summary.pdf",
                        "application/pdf",
                        (
                            "Beacon collections - one page summary",
                            "Problem: evidence lives in separate projects.",
                            "Scope: add notes from search, share a collection, clear empty state.",
                            "Success: 40% of weekly active teams create a second collection in 14 days.",
                            "Open question: should a collection inherit access from its project?",
                        ),
                    ),
                ),
            ),
            Message(
                "leo",
                ("maya",),
                15,
                "15:00",
                html(
                    "Read it twice. I would move sharing beside the title. I will test that in the "
                    "usability study next week before we commit.",
                    "Leo",
                ),
                cc=("arjun",),
            ),
            Message(
                "arjun",
                ("maya", "leo"),
                15,
                "17:25",
                html(
                    "On inheritance: I would rather not inherit access in the first release. It makes "
                    "removing a note from a project surprising. I will write the tradeoff up in the spec.",
                    "Arjun",
                ),
            ),
            Message(
                "maya",
                ("leo", "arjun"),
                14,
                "10:05",
                html("Agreed on both. No inheritance for the beta; sharing moves beside the title.", "Maya"),
            ),
        ),
    ),
    Thread(
        "pricing",
        "Pricing during the beta",
        (
            Message(
                "theo",
                ("maya", "sofia"),
                13,
                "12:00",
                html(
                    "Should beta customers see a price at all? I would prefer to say pricing stays "
                    "unchanged during the beta and revisit in January.",
                    "Theo",
                ),
            ),
            Message(
                "sofia",
                ("theo", "maya"),
                13,
                "15:40",
                html(
                    "Fine by me, as long as we measure support effort during the beta. I need that "
                    "number before anyone proposes a new tier.",
                    "Sofia",
                ),
            ),
        ),
    ),
    Thread(
        "q3-numbers",
        "Q3 numbers before the review",
        (
            Message(
                "sofia",
                ("maya", "theo", "arjun"),
                12,
                "09:00",
                html(
                    "Hi all,",
                    "Q3 closed at 108% of the revenue plan and 94% of the spend plan. The summary is "
                    "attached. Please check the lines for your team before I put them in the review deck.",
                    "Sofia",
                ),
                attachments=(
                    Attachment(
                        "q3-summary.csv",
                        "text/csv",
                        (
                            "Line,Plan (USD),Actual (USD),Variance",
                            "Revenue,412000,445300,8.1%",
                            "People,238000,226400,-4.9%",
                            "Infrastructure,41000,43800,6.8%",
                            "Marketing,36000,31200,-13.3%",
                            "Tools and software,12500,11900,-4.8%",
                        ),
                    ),
                ),
            ),
            Message(
                "theo",
                ("sofia",),
                11,
                "10:15",
                html(
                    "Marketing is right. The underspend is the conference we skipped in August.",
                    "Theo",
                ),
                cc=("maya", "arjun"),
            ),
            Message(
                "arjun",
                ("sofia",),
                11,
                "13:50",
                html(
                    "Infrastructure is over because of the load tests for import. It should drop in Q4.",
                    "Arjun",
                ),
                cc=("maya", "theo"),
            ),
            Message(
                "sofia",
                ("maya", "theo", "arjun"),
                10,
                "17:30",
                html(
                    "Thanks. The Q3 review deck in Drive now has these numbers, with your notes in the "
                    "speaker notes.",
                    "Sofia",
                ),
            ),
        ),
    ),
    Thread(
        "logo-options",
        "Brand refresh: logo options for the beta site",
        (
            Message(
                "leo",
                ("theo",),
                10,
                "11:30",
                html(
                    "Three directions for the beta landing page. My favourite is B: it keeps the "
                    "lighthouse but drops the gradient.",
                    "Leo",
                ),
                cc=("maya",),
                attachments=(
                    Attachment(
                        "logo-directions.txt",
                        "text/plain",
                        (
                            "A - Lighthouse with gradient beam (current)",
                            "B - Flat lighthouse, single colour, wordmark right",
                            "C - Wordmark only, beam as the dot of the i",
                        ),
                    ),
                ),
            ),
            Message(
                "theo",
                ("leo",),
                9,
                "09:20",
                html("B for me too. Can we see it on a dark background before we decide?", "Theo"),
                cc=("maya",),
            ),
        ),
    ),
    Thread(
        "september-expenses",
        "Expense report: September offsite",
        (
            Message(
                "nisha",
                ("sofia",),
                9,
                "16:10",
                html(
                    "Hi Sofia, attached is my expense report for the September offsite: train, hotel "
                    "and one team dinner. Receipts are uploaded in the expenses folder.",
                    "Nisha",
                ),
                attachments=(
                    Attachment(
                        "expenses-september.csv",
                        "text/csv",
                        (
                            "Date,Item,Amount (USD)",
                            "2026-09-14,Train to Lisbon,142.50",
                            "2026-09-14,Hotel (2 nights),318.00",
                            "2026-09-15,Team dinner,96.40",
                            "Total,,556.90",
                        ),
                    ),
                ),
            ),
            Message(
                "sofia",
                ("nisha",),
                8,
                "10:00",
                html("Approved. It goes out with the October payroll.", "Sofia"),
            ),
        ),
    ),
    Thread(
        "laptops",
        "Laptop refresh for Q4",
        (
            Message(
                "sofia",
                ("team",),
                8,
                "12:00",
                html(
                    "Hi all,",
                    "Laptops older than three years are due for replacement this quarter. If yours is "
                    "one of them, reply to me with your preferred model by 30 October.",
                    "Sofia",
                ),
            ),
            Message(
                "arjun",
                ("sofia",),
                8,
                "13:15",
                html("Mine is from 2022. The 14-inch model, please.", "Arjun"),
            ),
        ),
    ),
    Thread(
        "hiring",
        "Hiring: senior frontend engineer shortlist",
        (
            Message(
                "arjun",
                ("maya", "leo"),
                7,
                "10:30",
                html(
                    "We have four candidates for the senior frontend role. The tracker in Finance / "
                    "Q4 planning has their notes.",
                    "Leo, could you add portfolio feedback before the hiring review on Thursday?",
                    "Arjun",
                ),
                cc=("sofia",),
            ),
            Message(
                "leo",
                ("arjun",),
                6,
                "09:50",
                html("Yes. I will finish the design review by Wednesday afternoon.", "Leo"),
                cc=("maya", "sofia"),
            ),
            Message(
                "sofia",
                ("arjun",),
                6,
                "11:40",
                html(
                    "Budget has room for one senior hire starting in December. A second one would need "
                    "to wait for Q1.",
                    "Sofia",
                ),
                cc=("maya", "leo"),
            ),
        ),
        starred_by=("arjun",),
    ),
    Thread(
        "customer-feedback",
        "Collections feedback from Acme Research",
        (
            Message(
                "dana",
                ("maya",),
                6,
                "08:05",
                html(
                    "Hi Maya,",
                    "We tried the Collections preview with two of our researchers. They loved being "
                    "able to share a set of interviews with stakeholders. They did not find the share "
                    "button at first, and the import choked on our European date format.",
                    "Happy to join the beta.",
                    "Dana",
                ),
            ),
            Message(
                "maya",
                ("dana",),
                6,
                "10:20",
                html("Thank you Dana, this is very useful. You are on the list for 2 November.", "Maya"),
            ),
        ),
    ),
    Thread(
        "feedback-forward",
        "Fwd: Collections feedback from Acme Research",
        (
            Message(
                "maya",
                ("leo", "theo"),
                5,
                "11:00",
                html(
                    "Same two problems we saw in the study: sharing and dates. Theo, Acme is happy to be "
                    "a reference customer.",
                    "---------- Forwarded message ----------<br>From: Dana Whitfield "
                    "&lt;dana@acmeresearch.example&gt;<br>Subject: Collections feedback from Acme Research",
                    "We tried the Collections preview with two of our researchers. They loved being able "
                    "to share a set of interviews with stakeholders. They did not find the share button "
                    "at first, and the import choked on our European date format.",
                ),
            ),
            Message(
                "theo",
                ("maya",),
                5,
                "14:30",
                html("Great. I will ask Dana for a quote for the launch page.", "Theo"),
                cc=("leo",),
            ),
        ),
    ),
    Thread(
        "agency-landing-page",
        "Beacon launch page: banner and copy from Brightwave",
        (
            Message(
                "theo",
                ("brightwave",),
                4,
                "10:15",
                html(
                    "Hi Dana,",
                    "We launch the Beacon beta on 2 November. Could Brightwave draft the hero banner "
                    "and the first screen of copy for the landing page? Leo's logo direction B is the "
                    "starting point.",
                    "Theo",
                ),
            ),
            Message(
                "brightwave",
                ("theo",),
                1,
                "16:40",
                html(
                    "Hi Theo,",
                    "First draft attached: a dark banner with the flat lighthouse, and three headline "
                    "options. We can deliver final files by 29 October if you pick a headline this week.",
                    "Dana Brooks<br>Brightwave Agency",
                ),
                attachments=(
                    Attachment(
                        "beacon-landing-draft.txt",
                        "text/plain",
                        (
                            "Banner: flat lighthouse on dark navy, wordmark right",
                            "",
                            "Headline options:",
                            "1 - Keep the evidence beside the decision",
                            "2 - Every interview, one place to decide",
                            "3 - Research your whole team can use",
                        ),
                    ),
                ),
            ),
        ),
    ),
    Thread(
        "csv-import",
        "CSV import fails on mixed date formats",
        (
            Message(
                "nisha",
                ("engineering",),
                5,
                "15:45",
                html(
                    "Found it: we guess the date format from the first row only. Files that start with "
                    "an unambiguous date and later switch format fail halfway.",
                    "Plan: sample 200 rows, pick the format that parses all of them, and ask the user "
                    "when two formats do.",
                    "Nisha",
                ),
            ),
            Message(
                "arjun",
                ("nisha",),
                5,
                "16:30",
                html(
                    "Good find. Please add three customer exports to the release checklist so this "
                    "stays fixed.",
                    "Arjun",
                ),
            ),
            Message(
                "nisha",
                ("arjun",),
                1,
                "18:10",
                html(
                    "The fix is on staging. All three customer exports import cleanly, including Acme's.",
                    "Nisha",
                ),
                cc=("maya",),
            ),
        ),
    ),
    Thread(
        "study-findings",
        "Usability study: first findings",
        (
            Message(
                "leo",
                ("maya",),
                4,
                "17:00",
                html(
                    "Six sessions done. Five of six people created a collection without help. Three "
                    "looked for sharing beside the title. One keyboard user lost focus after closing "
                    "the share dialog.",
                    "The full write-up is in Design / Research.",
                    "Leo",
                ),
                cc=("arjun",),
            ),
            Message(
                "maya",
                ("leo",),
                3,
                "09:10",
                html(
                    "This is exactly what we needed. Let's retest the new share position with two "
                    "participants next week.",
                    "Maya",
                ),
                cc=("arjun",),
            ),
        ),
        starred_by=("maya",),
    ),
    Thread(
        "office-hours",
        "Community office hours on 6 November",
        (
            Message(
                "leo",
                ("arjun",),
                4,
                "12:15",
                html(
                    "Shall we do a 20 minute rehearsal for office hours? I will bring the demo flow, "
                    "you take questions about imports.",
                    "Leo",
                ),
            ),
            Message(
                "arjun",
                ("leo",),
                4,
                "13:00",
                html("Yes. I sent an invite for next Wednesday.", "Arjun"),
            ),
        ),
    ),
    Thread(
        "release-checklist",
        "Release checklist: add customer exports",
        (
            Message(
                "arjun",
                ("nisha",),
                3,
                "11:00",
                html(
                    "Before we ship the import fix, please add the Acme, Fieldnote and Harbor exports "
                    "to the release checklist with the expected row counts.",
                    "Arjun",
                ),
                cc=("maya",),
            ),
            Message(
                "nisha",
                ("arjun",),
                3,
                "14:35",
                html("Done. They are in the playbook under Before shipping.", "Nisha"),
                cc=("maya",),
            ),
        ),
    ),
    Thread(
        "invite-draft",
        "Beta invitation email: draft for review",
        (
            Message(
                "theo",
                ("maya", "leo"),
                3,
                "16:00",
                html(
                    "Draft attached. It is short on purpose: one sentence of value, one screenshot, "
                    "one button.",
                    "Theo",
                ),
                attachments=(
                    Attachment(
                        "beta-invitation-draft.txt",
                        "text/plain",
                        (
                            "Subject: You're invited to the Beacon Collections beta",
                            "",
                            "Keep the evidence beside the decision.",
                            "Collections bring interviews, notes and feedback into one place your team",
                            "can discuss. Join the private beta on 2 November.",
                            "",
                            "[Join the beta]",
                        ),
                    ),
                ),
            ),
            Message(
                "maya",
                ("theo",),
                2,
                "10:30",
                html("Love it. Can we say who it is for in the first line?", "Maya"),
                cc=("leo",),
            ),
            Message(
                "theo",
                ("maya", "leo"),
                0,
                "09:05",
                html(
                    "Updated: the first line now reads 'For product teams who run their own customer "
                    "interviews'. Sending Thursday unless you object.",
                    "Theo",
                ),
            ),
        ),
    ),
    Thread(
        "contractor-expense",
        "Expense approval needed: accessibility contractor",
        (
            Message(
                "leo",
                ("sofia",),
                2,
                "15:20",
                html(
                    "Hi Sofia, the accessibility contractor's October invoice is $2,000. Could you "
                    "approve it so it is paid this month?",
                    "Leo",
                ),
                cc=("maya",),
            ),
        ),
        starred_by=("sofia",),
    ),
    Thread(
        "support-budget",
        "Support budget for November",
        (
            Message(
                "maya",
                ("sofia",),
                2,
                "11:45",
                html(
                    "Sofia, can you confirm the support budget for November? I expect two extra hours "
                    "a day from Theo's team during the first beta week.",
                    "Maya",
                ),
            ),
            Message(
                "sofia",
                ("maya",),
                1,
                "16:20",
                html(
                    "Confirmed: $3,000 for November, tracked as its own line so we can see the beta's "
                    "real cost.",
                    "Sofia",
                ),
            ),
        ),
    ),
    Thread(
        "csv-forward",
        "Fwd: CSV import fails on mixed date formats",
        (
            Message(
                "arjun",
                ("maya",),
                1,
                "18:40",
                html(
                    "FYI, the import fix is done, so the beta date is safe from our side.",
                    "---------- Forwarded message ----------<br>From: Nisha Patel "
                    "&lt;nisha@northwind.test&gt;",
                    "The fix is on staging. All three customer exports import cleanly, including Acme's.",
                ),
            ),
        ),
    ),
    Thread(
        "lunch",
        "Lunch on Friday?",
        (
            Message(
                "theo",
                ("leo", "nisha"),
                1,
                "12:30",
                html("Tacos on Friday at 1? My treat for the logo work.", "Theo"),
            ),
            Message(
                "leo",
                ("theo", "nisha"),
                0,
                "08:50",
                html("Count me in.", "Leo"),
            ),
        ),
    ),
    Thread(
        "weekly-41",
        "Product Weekly #41: Writing decisions down",
        (
            Message(
                "weekly",
                EVERYONE,
                14,
                "07:00",
                html(
                    "<strong>This week:</strong> why the best product teams write decisions before "
                    "they meet, three templates for decision records, and a short interview with the "
                    "team behind a popular research tool.",
                    "<a href='https://productweekly.example/41'>Read online</a>",
                ),
            ),
        ),
        headers=NEWSLETTER_HEADERS,
    ),
    Thread(
        "weekly-42",
        "Product Weekly #42: Running a private beta",
        (
            Message(
                "weekly",
                EVERYONE,
                7,
                "07:00",
                html(
                    "<strong>This week:</strong> how many customers a private beta needs, what to "
                    "measure in the first seven days, and when to say no to feature requests.",
                    "<a href='https://productweekly.example/42'>Read online</a>",
                ),
            ),
        ),
        headers=NEWSLETTER_HEADERS,
    ),
    Thread(
        "invoice-sep",
        "Your Ledgerly invoice for September is ready",
        (
            Message(
                "ledgerly",
                ("sofia",),
                18,
                "06:00",
                html("Invoice NW-2026-09 for $1,240.00 is ready. It will be charged on 1 October."),
            ),
        ),
        headers=NOTIFICATION_HEADERS,
    ),
    Thread(
        "invoice-oct",
        "Payment reminder: invoice NW-2026-10 is due in 7 days",
        (
            Message(
                "ledgerly",
                ("sofia",),
                1,
                "06:00",
                html("Invoice NW-2026-10 for $1,240.00 is due on 27 October."),
            ),
        ),
        headers=NOTIFICATION_HEADERS,
    ),
    Thread(
        "review-request",
        "[beacon] Review requested: Detect date format from a sample of rows (#482)",
        (
            Message(
                "codehost",
                ("arjun",),
                1,
                "18:00",
                html(
                    "nisha-patel requested your review on pull request #482.",
                    "Detect date format from a sample of rows instead of the first row. "
                    "+212 -48 across 6 files.",
                ),
            ),
        ),
        headers=NOTIFICATION_HEADERS,
    ),
    Thread(
        "ci-passed",
        "[beacon] CI passed on main",
        (
            Message(
                "codehost",
                ("nisha", "arjun"),
                0,
                "07:30",
                html("All 1,284 checks passed on main at 3f9c2e1."),
            ),
        ),
        headers=NOTIFICATION_HEADERS,
    ),
)
