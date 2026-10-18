"""Realistic Northwind Writer bodies, encoded for the editor and its HTML fallback."""

import base64
from html import escape
from xml.etree import ElementTree as ET

import frappe
import pycrdt

from suite import drive
from suite.writer.drive import BODY_FRAGMENT

ONBOARDING = """
<h1>Welcome to Northwind Labs</h1>
<p>We build <strong>Beacon</strong>, a research workspace for small product teams.
Our promise: <em>turn customer evidence into decisions people can explain.</em></p>
<h2>Your first week</h2>
<ol><li><p>Meet your buddy and agree on a first project.</p></li>
<li><p>Read the customer interview library and sit in on a support call.</p></li>
<li><p>Ship one small improvement and share what you learned on Friday.</p></li></ol>
<h2>How we work</h2>
<ul><li><p>Write decisions down before scheduling a meeting.</p></li>
<li><p>Keep customer names out of public screenshots.</p></li>
<li><p>Use <a href="https://example.com/northwind/handbook">the company handbook</a>
for leave, expenses, and remote work questions.</p></li></ul>
<table><tbody><tr><th><p>Team</p></th><th><p>Contact</p></th><th><p>Ask about</p></th></tr>
<tr><td><p>Product</p></td><td><p>Maya Chen</p></td><td><p>Roadmap and research</p></td></tr>
<tr><td><p>Engineering</p></td><td><p>Arjun Rao</p></td><td><p>Local setup and releases</p></td></tr>
<tr><td><p>Finance</p></td><td><p>Sofia Martinez</p></td><td><p>Payroll and equipment</p></td></tr></tbody></table>
<h2>Setup checklist</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Accept your workspace invitation</p></li>
<li data-type="taskItem" data-checked="false"><p>Enable two-factor authentication</p></li>
<li data-type="taskItem" data-checked="false"><p>Book a 30-minute buddy introduction</p></li></ul>
<p><strong>Working hours:</strong> keep 14:00-17:00 UTC available for collaboration.
The rest of your day is yours to plan.</p>
"""

PRODUCT_SPEC = """
<h1>Beacon collections: product specification</h1>
<p><strong>Owner:</strong> Maya Chen | <strong>Status:</strong> ready for design review | October 2026</p>
<h2>Problem</h2><p>Research notes live in separate projects. Teams spend 20 minutes finding
supporting evidence before every roadmap review. Collections should make a reusable set of evidence easy to share.</p>
<h2>Scope for the first release</h2><ul><li><p>Add notes to a named collection from search.</p></li>
<li><p>Share a collection with a teammate as reader, commenter, or editor.</p></li>
<li><p>Show a clear empty state and preserve the current filters when returning to search.</p></li></ul>
<h2>Acceptance criteria</h2><ol><li><p>A reader can open evidence but cannot change the collection.</p></li>
<li><p>Removing a note from a collection does not delete the source note.</p></li>
<li><p>Keyboard users can create and rename a collection without a pointer.</p></li></ol>
<h2>Success measure</h2><p>At least <strong>40% of weekly active teams</strong> create a second collection
within 14 days. Track time to first shared collection separately from adoption.</p>
<h2>Open question</h2><p><em>Should a collection inherit access from its project?</em>
Arjun will document the permission tradeoff before implementation begins.</p>
"""

MEETING = """
<h1>Launch readiness - 19 October</h1><p><strong>Present:</strong> Maya, Leo, Arjun, Nisha, Theo, Sofia</p>
<h2>Decisions</h2><ul><li><p>Invite 12 existing customers to the private beta on 2 November.</p></li>
<li><p>Keep pricing unchanged during beta; measure support effort before introducing a new tier.</p></li>
<li><p>Use a recorded walkthrough for onboarding across time zones.</p></li></ul>
<h2>Risks</h2><p>CSV import still fails on mixed date formats. Nisha owns the fix;
Arjun will add representative customer exports to the release checklist.</p>
<h2>Actions</h2><ul data-type="taskList">
<li data-type="taskItem" data-checked="true"><p>Leo: approve empty states and keyboard focus order</p></li>
<li data-type="taskItem" data-checked="false"><p>Theo: send beta invitations by Thursday</p></li>
<li data-type="taskItem" data-checked="false"><p>Sofia: confirm the support budget for November</p></li></ul>
<p>Next check-in: Thursday, 15:00 UTC. Post updates in the launch folder beforehand.</p>
"""

ENGINEERING = """
<h1>Release playbook</h1><h2>Before shipping</h2><ol>
<li><p>Review the migration plan with someone outside the feature team.</p></li>
<li><p>Run the smoke checks on staging with a normal member account.</p></li>
<li><p>Confirm that the previous build and database backup are available.</p></li></ol>
<h2>During rollout</h2><p>Release to internal accounts first, then 10% of customers.
Watch error rate and import latency for 30 minutes before continuing.</p>
<h2>Rollback</h2><p><strong>Stop the rollout</strong> if error rate exceeds 1% for five minutes.
Arjun coordinates recovery; Nisha records the incident timeline.</p>
"""

DESIGN = """
<h1>Collections usability study</h1><p><strong>Researcher:</strong> Leo Park | Six remote sessions, 12-16 October</p>
<h2>What worked</h2><p>Five participants created a collection without help. People understood
that a collection is a view of existing notes rather than another copy.</p>
<h2>Where people hesitated</h2><ul><li><p>Three participants expected sharing to be available from the title.</p></li>
<li><p>Two missed the confirmation after adding a note.</p></li>
<li><p>One keyboard user lost focus after closing the share dialog.</p></li></ul>
<h2>Recommendation</h2><p>Keep the word <em>collection</em>. Move sharing beside the title and
return focus to the trigger after closing the dialog. Retest with two participants next week.</p>
"""

MARKETING = """
<h1>Beacon beta launch brief</h1><h2>Audience</h2><p>Product teams of 5-25 people who already
run customer interviews but struggle to connect evidence to roadmap decisions.</p>
<h2>Message</h2><p><strong>Keep the evidence beside the decision.</strong> Collections bring
interviews, notes, and feedback into one place your whole team can discuss.</p>
<h2>Channels</h2><ul><li><p>Customer email: 2 November, sent by Theo.</p></li>
<li><p>Product walkthrough: 4 November, recorded by Maya.</p></li>
<li><p>Community office hours: 6 November, hosted by Leo and Arjun.</p></li></ul>
<h2>Measurement</h2><p>Report qualified replies, first shared collections, and seven-day return rate.
Email opens are directional only. Spend cap: <strong>$4,500</strong>.</p>
"""


def writer(parent: str, title: str, html: str) -> str:
    """Create a populated Writer document through Drive."""
    node = drive.create_document(parent, title, content_doctype="Writer Document")
    ydoc = pycrdt.Doc()
    fragment = ydoc.get(BODY_FRAGMENT, type=pycrdt.XmlFragment)
    _append(fragment, ET.fromstring(f"<doc>{html}</doc>"))
    body = base64.b64encode(ydoc.get_update()).decode()
    name = frappe.db.get_value("Writer Document", {"node": node})
    frappe.db.set_value("Writer Document", name, {"content": body, "html": html})
    return node


def personal_note(first_name: str, team: str) -> str:
    return f"""<h1>{escape(first_name)}'s working notes</h1>
<p><strong>{escape(team)} priorities - week of 19 October</strong></p>
<ul><li><p>Review the beta feedback before Wednesday's planning session.</p></li>
<li><p>Reserve two hours for focused work on the launch checklist.</p></li>
<li><p>Write down one thing we can simplify for the next release.</p></li></ul>
<h2>Questions for my next one-to-one</h2><p>Which customer problem should we solve next?
What can I hand over before taking time off in December?</p>
<p><em>Draft thoughts; please comment before editing the priorities.</em></p>"""


def _append(parent: pycrdt.XmlFragment | pycrdt.XmlElement, source: ET.Element) -> None:
    if source.text:
        _text(parent, source.text, {})
    tags = {
        "p": "paragraph",
        "h1": "heading",
        "h2": "heading",
        "ul": "bulletList",
        "ol": "orderedList",
        "li": "listItem",
        "table": "table",
        "tr": "tableRow",
        "td": "tableCell",
        "th": "tableHeader",
    }
    for child in source:
        if child.tag == "tbody":
            _append(parent, child)
        elif child.tag in ("strong", "em", "a"):
            mark = {"strong": "bold", "em": "italic", "a": "link"}[child.tag]
            attributes = (
                {"href": child.attrib["href"], "target": "_blank", "rel": "noopener noreferrer"}
                if mark == "link"
                else {}
            )
            _text(parent, "".join(child.itertext()), {mark: attributes})
        else:
            tag = child.attrib.get("data-type", tags[child.tag])
            element = parent.children.append(pycrdt.XmlElement(tag))
            if child.tag in ("h1", "h2"):
                element.attributes["level"] = int(child.tag[1])
            if tag == "taskItem":
                element.attributes["checked"] = child.attrib.get("data-checked") == "true"
            _append(element, child)
        if child.tail:
            _text(parent, child.tail, {})


def _text(parent: pycrdt.XmlFragment | pycrdt.XmlElement, value: str, marks: dict) -> None:
    # Formatting whitespace between HTML blocks is not editor content.
    if not value.strip():
        return
    value = (
        (" " if value[0].isspace() else "") + " ".join(value.split()) + (" " if value[-1].isspace() else "")
    )
    if len(parent.children) and isinstance(parent.children[len(parent.children) - 1], pycrdt.XmlText):
        text = parent.children[len(parent.children) - 1]
    else:
        text = parent.children.append(pycrdt.XmlText())
    text.insert(len(text), value, marks)
