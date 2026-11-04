"""Seed/reset a fictional company for manual Drive testing, never during migration.

Run with `pilot -b suite frappe --site suite.localhost execute suite.composition.demo.drive.seed`.
The six fixed accounts are reserved for this dataset, so anything they own counts as demo data.
Reset removes their Mail, purges their personal roots and Shared-root nodes, restores the
workspace name and logo, then removes their groups and accounts. Other users and the site's
Shared root are retained. Each completed batch is committed, so a failed run can be removed with
reset. Internal Drive helpers fill gaps in its facade, which composition may reach.
When the site has a `mail` server configured, the seed ends with `suite.composition.demo.mail.seed`.
"""

import json
from io import BytesIO

import frappe
from frappe.utils import get_url

from suite import drive
from suite.api.account import delete_logo_file
from suite.composition.demo import assets, content, mail
from suite.composition.demo.cast import PASSWORD, PEOPLE, acting_as, email_of
from suite.drive._core import activity, comments, nodes
from suite.drive._core.access import grant, revoke_grant
from suite.drive._core.roots import archive_personal_root, create_root, purge_root
from suite.drive.framework import principals_for
from suite.suite_core.storage import state as storage_state

WORKSPACE = "Northwind Labs"
PREFIX = f"{WORKSPACE} - "
LOGO = "northwind-labs-logo.png"
PREVIOUS_BRANDING = "northwind_demo_previous_branding"
TEAMS = ("Product", "Design", "Engineering", "Marketing", "Finance")
PERSONAL_FILES = {
    "maya": "Northwind brand cover.png",
    "leo": "Weekly active teams.png",
    "arjun": "Equipment policy.pdf",
    "nisha": "Beta customer feedback.csv",
    "theo": "Launch checklist.md",
    "sofia": "Read me.txt",
}
PERSONAL_SHARES = {
    "maya": ("leo", drive.READ),
    "leo": ("arjun", drive.COMMENT),
    "arjun": ("nisha", drive.EDIT),
    "nisha": ("theo", drive.READ),
    "theo": ("sofia", drive.COMMENT),
    "sofia": ("maya", drive.EDIT),
}
CONVERSATIONS = (
    (
        "spec",
        "document",
        "leo",
        "Can we keep sharing beside the title? Three study participants looked there first.",
        "maya",
        "Agreed. I added that to the acceptance criteria for the beta.",
    ),
    (
        "budget",
        "sheets:cell:B3!Sheet1",
        "leo",
        "Does October include the contractor helping with accessibility?",
        "sofia",
        "Yes, $2,000 is included in the People line. November covers a full month.",
    ),
    (
        "hiring",
        "sheets:workbook",
        "sofia",
        "Please add portfolio feedback before the Thursday hiring review.",
        "leo",
        "I will finish the design review by Wednesday afternoon.",
    ),
    (
        "meeting",
        "document",
        "theo",
        "Invitations are drafted. Waiting on the final customer list.",
        "maya",
        "The list is approved. Please start with the six teams who joined the research study.",
    ),
)


def seed(fresh: bool = False) -> None:
    """Create Northwind; refuse an existing dataset unless fresh=True."""
    with acting_as("Administrator"):
        try:
            if fresh:
                reset()
            if _exists():
                print(
                    "Northwind demo data already exists. Run suite.composition.demo.drive.reset first, "
                    "or seed with fresh=True. To retry only Mail, run suite.composition.demo.mail.seed."
                )
                return
            print("Creating Northwind demo users...")
            _users_and_groups()
            _branding()
            frappe.db.commit()
            shared = frappe.db.get_value("Drive Root", {"kind": "Shared", "state": "Active"})
            if not shared:
                shared = create_root(kind="Shared", title="Drive").name
            with acting_as(email_of("maya")):
                folders = _organization_folders(shared)
            frappe.db.commit()
            uploaded = assets.uploaded_files()
            shared_nodes = _organization_content(folders, uploaded)
            personal_nodes = _personal_content(uploaded)
            _sharing_and_activity(personal_nodes, shared_nodes, folders)
            frappe.db.commit()
            print(f"\nNorthwind Labs is ready: {get_url()}\nPassword for all six users: {PASSWORD}\n")
            print(f"{'User':30} {'Name':20} Role")
            for person in PEOPLE:
                print(f"{person.email:30} {person.name:20} {person.job}")
            print(f"\nPublished beta brief: {get_url()}{drive.node_url(shared_nodes['launch brief'])}")
            if frappe.conf.mail:
                mail.seed(fresh=fresh)
        except Exception:
            frappe.db.rollback()
            print(
                "Seed failed. Completed batches remain; run reset or seed(fresh=True) before retrying. "
                "If only Mail failed, suite.composition.demo.mail.seed adds what is missing."
            )
            raise


def reset() -> None:
    """Permanently remove the reserved Northwind accounts, their Mail and their Drive content."""
    with acting_as("Administrator"):
        try:
            if frappe.conf.mail:
                mail.reset()
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
            _restore_branding()
            for team in TEAMS:
                group = PREFIX + team
                if frappe.db.exists("User Group", group):
                    grants = frappe.get_all(
                        "Drive Grant", filters={"principal": f"$GROUP:{group}"}, pluck="name"
                    )
                    for grant_name in grants:
                        revoke_grant(grant_name, admin)
                    frappe.delete_doc("User Group", group, ignore_permissions=True)
            # Deleting a User only unlinks its Contact.
            for contact in frappe.get_all("Contact", filters={"user": ["in", emails]}, pluck="name"):
                frappe.delete_doc("Contact", contact, ignore_permissions=True)
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


def _exists() -> bool:
    emails = [person.email for person in PEOPLE]
    return bool(
        frappe.db.exists("User", {"name": ["in", emails]})
        or frappe.db.exists("Drive Root", {"user": ["in", emails]})
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
            members.append(email_of("leo"))
        frappe.get_doc(
            {
                "doctype": "User Group",
                "__newname": PREFIX + team,
                "user_group_members": [{"user": email} for email in members],
            }
        ).insert(ignore_permissions=True)


def _branding() -> None:
    if not frappe.defaults.get_global_default(PREVIOUS_BRANDING):
        previous = {
            field: frappe.db.get_single_value("Suite Settings", field)
            for field in ("workspace_name", "workspace_logo")
        }
        frappe.defaults.set_global_default(PREVIOUS_BRANDING, json.dumps(previous))
    logo = assets.brand_file("northwind-icon.png", LOGO, "Suite Settings", "Suite Settings", "workspace_logo")
    frappe.db.set_single_value("Suite Settings", {"workspace_name": WORKSPACE, "workspace_logo": logo})
    for person in PEOPLE:
        image = assets.brand_file(
            f"avatars/{person.key}.png", f"{person.key}-avatar.png", "User", person.email, "user_image"
        )
        frappe.db.set_value("User", person.email, "user_image", image)


def _restore_branding() -> None:
    """Put back the workspace name and logo the seed replaced, unless someone has changed them since."""
    previous = json.loads(frappe.defaults.get_global_default(PREVIOUS_BRANDING) or "{}")
    logo = frappe.db.get_single_value("Suite Settings", "workspace_logo")
    if logo and frappe.db.exists("File", {"file_url": logo, "file_name": LOGO}):
        frappe.db.set_single_value("Suite Settings", "workspace_logo", previous.get("workspace_logo") or "")
        delete_logo_file(logo)
    if frappe.db.get_single_value("Suite Settings", "workspace_name") == WORKSPACE:
        frappe.db.set_single_value("Suite Settings", "workspace_name", previous.get("workspace_name") or "")
    frappe.defaults.clear_default(key=PREVIOUS_BRANDING)


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


def _organization_content(folders: dict[str, str], uploaded: dict[str, bytes]) -> dict[str, str]:
    result = {}
    with acting_as(email_of("maya")):
        handbook = drive.ensure_folder(folders["Company"], "Handbook")
        result["welcome"] = content.writer(handbook, "Welcome to Northwind", content.ONBOARDING)
        reference = drive.ensure_folder(handbook, "Policies and reference")
        for title in uploaded:
            _store(reference, title, uploaded)
        result["review"] = assets.presentation(
            folders["Company"], "Q3 review and Q4 priorities", assets.REVIEW
        )
        frappe.db.commit()
        project = drive.ensure_folder(drive.ensure_folder(folders["Product"], "Beacon"), "Collections beta")
        result["spec"] = content.writer(project, "Collections product specification", content.PRODUCT_SPEC)
        result["meeting"] = content.writer(project, "Launch readiness - 19 October", content.MEETING)
    frappe.db.commit()
    with acting_as(email_of("leo")):
        research = drive.ensure_folder(drive.ensure_folder(folders["Design"], "Research"), "October studies")
        result["research"] = content.writer(research, "Collections usability study", content.DESIGN)
        _store(research, "Northwind brand cover.png", uploaded)
    frappe.db.commit()
    with acting_as(email_of("arjun")):
        releases = drive.ensure_folder(folders["Engineering"], "Releases")
        result["playbook"] = content.writer(releases, "Release playbook", content.ENGINEERING)
        _store(releases, "Beta customer feedback.csv", uploaded)
    frappe.db.commit()
    with acting_as(email_of("theo")):
        launch = drive.ensure_folder(folders["Marketing"], "November launch")
        brief = content.writer(launch, "Beacon beta launch brief", content.MARKETING)
        result["launch brief"] = brief
        # Publishing only this document leaves the restricted team folder private. $PUBLIC alone
        # does not lift the folder's $GENERAL deny for signed-in people, and nearest wins, so
        # opening it to $GENERAL also needs the team's own grant repeated here.
        with acting_as(email_of("maya")):
            _grant(brief, "$PUBLIC", drive.READ)
            _grant(brief, "$GENERAL", drive.READ)
            _grant(brief, f"$GROUP:{PREFIX}Marketing", drive.MANAGE)
        result["launch deck"] = assets.presentation(launch, "Beacon collections launch", assets.LAUNCH)
        imports = drive.ensure_folder(folders["Marketing"], "Imports")
        result["pipeline"] = assets.spreadsheet(
            folders["Marketing"], imports, "November sales pipeline", assets.PIPELINE, "pipeline"
        )
    frappe.db.commit()
    with acting_as(email_of("sofia")):
        planning = drive.ensure_folder(folders["Finance"], "Q4 planning")
        imports = drive.ensure_folder(planning, "Imports")
        result["budget"] = assets.spreadsheet(
            planning, imports, "Q4 operating budget", assets.BUDGET, "budget"
        )
        result["hiring"] = assets.spreadsheet(planning, imports, "Q4 hiring tracker", assets.HIRING, "hiring")
    frappe.db.commit()
    return result


def _personal_content(uploaded: dict[str, bytes]) -> dict[str, str]:
    result = {}
    for person in PEOPLE:
        with acting_as(person.email):
            root = drive.ensure_personal_root(person.email)
            if root is None:
                raise RuntimeError(f"Missing personal root for {person.email}")
            work = drive.ensure_folder(root, "Working notes")
            result[person.email] = content.writer(
                work, f"{person.first}'s weekly priorities", content.personal_note(person.first, person.team)
            )
            archive = drive.ensure_folder(drive.ensure_folder(root, "Projects"), "October 2026")
            _store(archive, PERSONAL_FILES[person.key], uploaded)
            scratchpad = f"{person.first}'s private scratchpad\nFollow up on beta feedback on Friday.\n"
            drive.store_file(root, "Quick notes.txt", BytesIO(scratchpad.encode()))
        frappe.db.commit()
    return result


def _sharing_and_activity(personal: dict[str, str], shared: dict[str, str], folders: dict[str, str]) -> None:
    for person in PEOPLE:
        colleague, role = PERSONAL_SHARES[person.key]
        with acting_as(person.email):
            _grant(personal[person.email], email_of(colleague), role)
    # Cross-team collaboration exercises comments without granting the whole team tree.
    with acting_as(email_of("maya")):
        for key in ("spec", "budget", "hiring"):
            _grant(shared[key], email_of("leo"), drive.COMMENT)
        _grant(shared["spec"], email_of("arjun"), drive.EDIT)
        _grant(shared["meeting"], email_of("theo"), drive.COMMENT)
    for key, anchor, author, text, responder, response in CONVERSATIONS:
        with acting_as(email_of(author)):
            thread = comments.create_thread(principals_for(frappe.session.user), shared[key], anchor, text)
        with acting_as(email_of(responder)):
            comments.reply(principals_for(frappe.session.user), thread["name"], response)
    for person in PEOPLE:
        with acting_as(person.email):
            principals = principals_for(person.email)
            activity.set_favourite(principals, personal[person.email])
            activity.set_favourite(principals, folders[person.team])
            for node in (personal[person.email], shared["welcome"], shared["review"]):
                activity.visit(principals, node)
        frappe.db.commit()


def _store(parent: str, title: str, uploaded: dict[str, bytes]) -> None:
    drive.store_file(parent, title, BytesIO(uploaded[title]))
