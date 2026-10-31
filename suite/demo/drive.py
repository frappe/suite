"""Seed/reset a fictional company for manual Drive testing, never during migration.

Run with `pilot -b suite frappe --site suite.localhost execute suite.demo.drive.seed`.
The six fixed accounts are reserved for this dataset. Reset purges their personal
roots and Shared-root nodes, the Northwind logo, then their groups and accounts. Other users
and the site's Shared root are retained. Each completed batch is committed, so a
failed run can be removed with reset. Internal Drive helpers fill gaps in its facade.
When the site has a `mail` server configured, the seed ends with `suite.demo.mail.seed`.
"""

import json
from dataclasses import dataclass
from io import BytesIO

import frappe

from suite import drive
from suite.api.account import delete_logo_file
from suite.demo import assets, content
from suite.drive._core import activity, comments, nodes
from suite.drive._core.access import grant
from suite.drive._core.roots import archive_personal_root, create_root, purge_root
from suite.drive.framework import principals_for
from suite.suite_core.storage import state as storage_state

PASSWORD = "NorthwindDemo!2026"
URL = "https://suite.netchamp.dev"
PREFIX = "Northwind Labs - "
LOGO = "northwind-labs-logo.png"
TEAMS = ("Product", "Design", "Engineering", "Marketing", "Finance")


@dataclass(frozen=True)
class Person:
    first: str
    last: str
    team: str
    job: str
    admin: bool = False

    @property
    def email(self) -> str:
        return f"{self.first.lower()}@northwind.test"


PEOPLE = (
    Person("Maya", "Chen", "Product", "Product lead / Suite Admin", admin=True),
    Person("Leo", "Park", "Design", "Product designer"),
    Person("Arjun", "Rao", "Engineering", "Engineering lead"),
    Person("Nisha", "Patel", "Engineering", "Software engineer"),
    Person("Theo", "Williams", "Marketing", "Growth lead"),
    Person("Sofia", "Martinez", "Finance", "Finance and operations"),
)


def seed(fresh: bool = False) -> None:
    """Create Northwind; refuse an existing dataset unless fresh=True."""
    frappe.set_user("Administrator")
    try:
        if fresh:
            reset()
        if _exists():
            print(
                "Northwind demo data already exists. Run suite.demo.drive.reset first, or seed with fresh=True."
            )
            return
        print("Creating Northwind demo users...")
        _users_and_groups()
        _branding()
        frappe.db.commit()
        shared = frappe.db.get_value("Drive Root", {"kind": "Shared", "state": "Active"})
        if not shared:
            shared = create_root(kind="Shared", title="Drive").name
        frappe.set_user(PEOPLE[0].email)
        folders = _organization_folders(shared)
        frappe.db.commit()
        uploaded = assets.uploaded_files()
        shared_nodes = _organization_content(folders, uploaded)
        personal_nodes = _personal_content(uploaded)
        _sharing_and_activity(personal_nodes, shared_nodes, folders)
        frappe.db.commit()
        print(f"\nNorthwind Labs is ready: {URL}\nPassword for all six users: {PASSWORD}\n")
        print(f"{'User':30} {'Name':20} Role")
        for person in PEOPLE:
            print(f"{person.email:30} {person.first + ' ' + person.last:20} {person.job}")
        print(f"\nPublished beta brief: {URL}{drive.node_url(shared_nodes['launch brief'])}")
        if frappe.conf.mail:
            # Imported here: mail reads the cast from this module.
            from suite.demo import mail

            mail.seed(fresh=fresh)
    except Exception:
        frappe.db.rollback()
        print("Seed failed. Completed batches remain; run reset or seed(fresh=True) before retrying.")
        raise
    finally:
        frappe.set_user("Administrator")


def reset() -> None:
    """Permanently remove the reserved Northwind accounts and their Drive content."""
    frappe.set_user("Administrator")
    try:
        emails = [person.email for person in PEOPLE]
        admin = principals_for("Administrator")
        # Pick all Shared roots, including archived ones, and shallow nodes first.
        # Descendants are removed by their parent's purge, including embedded media.
        shared_roots = frappe.get_all("Drive Root", filters={"kind": "Shared"}, pluck="name")
        shared_nodes = (
            frappe.get_all(
                "Drive Node",
                filters={"root": ["in", shared_roots], "owner": ["in", emails]},
                fields=["name", "path"],
            )
            if shared_roots
            else []
        )
        for row in sorted(shared_nodes, key=lambda row: len(row.path or "")):
            current = frappe.db.get_value("Drive Node", row.name, ["state", "trash_root"], as_dict=True)
            if not current:
                continue
            if current.state == "Active":
                nodes.update(admin, row.name, state="Trashed")
            elif current.trash_root != row.name:
                continue
            nodes.purge(admin, row.name)
        frappe.db.commit()
        for person in PEOPLE:
            roots = frappe.get_all(
                "Drive Root", filters={"kind": "Personal", "user": person.email}, fields=["name", "state"]
            )
            for root in roots:
                if root.state == "Active":
                    archive_personal_root(person.email)
                purge_root(root.name, admin)
            frappe.db.commit()
        _remove_logo()
        for team in TEAMS:
            group = PREFIX + team
            if frappe.db.exists("User Group", group):
                frappe.db.delete("Drive Grant", {"principal": f"$GROUP:{group}"})
                frappe.delete_doc("User Group", group, ignore_permissions=True)
        for person in PEOPLE:
            if frappe.db.exists("User", person.email):
                frappe.delete_doc("User", person.email, ignore_permissions=True)
        storage, policy, measurements = storage_state(lock=True)
        limits = policy.get("users", {})
        personal = measurements.get("personal", {})
        for email in emails:
            limits.pop(email, None)
            personal.pop(email, None)
        storage.policy = json.dumps(policy)
        storage.measurements = json.dumps(measurements)
        storage.save(ignore_permissions=True)
        frappe.db.commit()
        print("Removed Northwind demo users, groups, personal roots, and organization content.")
    except Exception:
        frappe.db.rollback()
        raise
    finally:
        frappe.set_user("Administrator")


def _exists() -> bool:
    emails = [person.email for person in PEOPLE]
    return bool(
        frappe.db.exists("User", {"name": ["in", emails]})
        or frappe.db.exists("Drive Root", {"user": ["in", emails]})
        or frappe.db.exists("Drive Node", {"owner": ["in", emails]})
        or frappe.db.exists("User Group", {"name": ["in", [PREFIX + team for team in TEAMS]]})
    )


def _users_and_groups() -> None:
    for person in PEOPLE:
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": person.email,
                "first_name": person.first,
                "last_name": person.last,
                "enabled": 1,
                "send_welcome_email": 0,
                "new_password": PASSWORD,
            }
        ).insert(ignore_permissions=True)
        user.add_roles("Suite User")
        if person.admin:
            user.add_roles("Suite Admin")
    for team in TEAMS:
        members = [person.email for person in PEOPLE if person.team == team]
        if team == "Product":
            members.append(PEOPLE[1].email)
        frappe.get_doc(
            {
                "doctype": "User Group",
                "__newname": PREFIX + team,
                "user_group_members": [{"user": email} for email in members],
            }
        ).insert(ignore_permissions=True)


def _branding() -> None:
    logo = assets.brand_file("northwind-icon.png", LOGO, "Suite Settings", "Suite Settings", "workspace_logo")
    frappe.db.set_single_value("Suite Settings", {"workspace_name": "Northwind Labs", "workspace_logo": logo})
    for person in PEOPLE:
        name = person.first.lower()
        image = assets.brand_file(
            f"avatars/{name}.png", f"{name}-avatar.png", "User", person.email, "user_image"
        )
        frappe.db.set_value("User", person.email, "user_image", image)


def _remove_logo() -> None:
    """Clear the workspace logo only while it is still the Northwind one."""
    logo = frappe.db.get_single_value("Suite Settings", "workspace_logo")
    if logo and frappe.db.exists("File", {"file_url": logo, "file_name": LOGO}):
        frappe.db.set_single_value("Suite Settings", "workspace_logo", "")
        delete_logo_file(logo)


def _grant(node: str, principal: str, role: int) -> None:
    grant(node, principal, role, principals_for(frappe.session.user), notify=False)


def _organization_folders(shared: str) -> dict[str, str]:
    folders = {}
    for team in TEAMS:
        folder = drive.ensure_folder(shared, PREFIX + team)
        _grant(folder, "$GENERAL", 0)
        _grant(folder, f"$GROUP:{PREFIX}{team}", drive.MANAGE)
        folders[team] = folder
    company = drive.ensure_folder(shared, PREFIX + "Company")
    _grant(company, "$GENERAL", drive.READ)
    folders["Company"] = company
    return folders


def _organization_content(folders: dict[str, str], uploaded: list[tuple[str, bytes]]) -> dict[str, str]:
    result = {}
    handbook = drive.ensure_folder(folders["Company"], "Handbook")
    result["welcome"] = content.writer(handbook, "Welcome to Northwind", content.ONBOARDING)
    reference = drive.ensure_folder(handbook, "Policies and reference")
    for title, data in uploaded:
        drive.store_file(reference, title, BytesIO(data))
    result["review"] = assets.presentation(folders["Company"], "Q3 review and Q4 priorities", assets.REVIEW)
    frappe.db.commit()
    for person in PEOPLE:
        if person.first == "Nisha":
            continue
        frappe.set_user(person.email)
        folder = folders[person.team]
        if person.team == "Product":
            project = drive.ensure_folder(drive.ensure_folder(folder, "Beacon"), "Collections beta")
            result["spec"] = content.writer(
                project, "Collections product specification", content.PRODUCT_SPEC
            )
            result["meeting"] = content.writer(project, "Launch readiness - 19 October", content.MEETING)
        elif person.team == "Design":
            research = drive.ensure_folder(drive.ensure_folder(folder, "Research"), "October studies")
            result["research"] = content.writer(research, "Collections usability study", content.DESIGN)
            drive.store_file(research, uploaded[0][0], BytesIO(uploaded[0][1]))
        elif person.team == "Engineering":
            releases = drive.ensure_folder(folder, "Releases")
            result["playbook"] = content.writer(releases, "Release playbook", content.ENGINEERING)
            drive.store_file(releases, uploaded[3][0], BytesIO(uploaded[3][1]))
        elif person.team == "Marketing":
            launch = drive.ensure_folder(folder, "November launch")
            result["launch brief"] = content.writer(launch, "Beacon beta launch brief", content.MARKETING)
            # Publishing only this document leaves the restricted team folder private.
            frappe.set_user(PEOPLE[0].email)
            _grant(result["launch brief"], "$PUBLIC", drive.READ)
            frappe.set_user(person.email)
            result["launch deck"] = assets.presentation(launch, "Beacon collections launch", assets.LAUNCH)
            imports = drive.ensure_folder(folder, "Imports")
            result["pipeline"] = assets.spreadsheet(
                folder, imports, "November sales pipeline", assets.PIPELINE, "pipeline"
            )
        else:
            planning = drive.ensure_folder(folder, "Q4 planning")
            imports = drive.ensure_folder(planning, "Imports")
            result["budget"] = assets.spreadsheet(
                planning, imports, "Q4 operating budget", assets.BUDGET, "budget"
            )
            result["hiring"] = assets.spreadsheet(
                planning, imports, "Q4 hiring tracker", assets.HIRING, "hiring"
            )
        frappe.db.commit()
    return result


def _personal_content(uploaded: list[tuple[str, bytes]]) -> dict[str, str]:
    result = {}
    for index, person in enumerate(PEOPLE):
        frappe.set_user(person.email)
        root = drive.ensure_personal_root(person.email)
        if root is None:
            raise RuntimeError(f"Missing personal root for {person.email}")
        work = drive.ensure_folder(root, "Working notes")
        result[person.email] = content.writer(
            work, f"{person.first}'s weekly priorities", content.personal_note(person.first, person.team)
        )
        archive = drive.ensure_folder(drive.ensure_folder(root, "Projects"), "October 2026")
        title, data = uploaded[index]
        drive.store_file(archive, title, BytesIO(data))
        drive.store_file(
            root,
            "Quick notes.txt",
            BytesIO(f"{person.first}'s private scratchpad\nFollow up on beta feedback on Friday.\n".encode()),
        )
        frappe.db.commit()
    return result


def _sharing_and_activity(personal: dict[str, str], shared: dict[str, str], folders: dict[str, str]) -> None:
    for index, person in enumerate(PEOPLE):
        frappe.set_user(person.email)
        colleague = PEOPLE[(index + 1) % len(PEOPLE)]
        _grant(personal[person.email], colleague.email, (drive.READ, drive.COMMENT, drive.EDIT)[index % 3])
    # Cross-team collaboration exercises comments without granting the whole team tree.
    frappe.set_user(PEOPLE[0].email)
    for key in ("spec", "budget", "hiring"):
        _grant(shared[key], PEOPLE[1].email, drive.COMMENT)
    _grant(shared["spec"], PEOPLE[2].email, drive.EDIT)
    _grant(shared["meeting"], PEOPLE[4].email, drive.COMMENT)
    conversations = (
        (
            "spec",
            "document",
            1,
            "Can we keep sharing beside the title? Three study participants looked there first.",
            0,
            "Agreed. I added that to the acceptance criteria for the beta.",
        ),
        (
            "budget",
            "sheets:cell:B3!Sheet1",
            1,
            "Does October include the contractor helping with accessibility?",
            5,
            "Yes, $2,000 is included in the People line. November covers a full month.",
        ),
        (
            "hiring",
            "sheets:workbook",
            5,
            "Please add portfolio feedback before the Thursday hiring review.",
            1,
            "I will finish the design review by Wednesday afternoon.",
        ),
        (
            "meeting",
            "document",
            4,
            "Invitations are drafted. Waiting on the final customer list.",
            0,
            "The list is approved. Please start with the six teams who joined the research study.",
        ),
    )
    for key, anchor, author, text, responder, response in conversations:
        frappe.set_user(PEOPLE[author].email)
        thread = comments.create_thread(principals_for(frappe.session.user), shared[key], anchor, text)
        frappe.set_user(PEOPLE[responder].email)
        comments.reply(principals_for(frappe.session.user), thread["name"], response)
    for person in PEOPLE:
        frappe.set_user(person.email)
        principals = principals_for(person.email)
        activity.set_favourite(principals, personal[person.email])
        activity.set_favourite(principals, folders[person.team])
        for node in (personal[person.email], shared["welcome"], shared["review"]):
            activity.visit(principals, node)
        frappe.db.commit()
