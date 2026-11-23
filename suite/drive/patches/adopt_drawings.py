"""Bind legacy Draw bodies before Cleanup and Drive registry validation.

This migration belongs to Drive: products do not write node identities.
Only the node link changes on a Drawing. Bodies, legacy titles, owners and
timestamps remain intact. Grants and share removal join the same transaction.
"""

from uuid import uuid4

import frappe
from frappe import _
from frappe.utils import now, validate_email_address

from suite.drive._core.roles import MANAGE
from suite.drive.patches.build.content import _ensure_personal_root, _grant_row
from suite.drive.patches.build.content_mapping import docshare_role, expected_node
from suite.drive.patches.build.docshare_journal import DOCSHARE_COLUMNS, DocSharePreimageJournal
from suite.drive.patches.build.mapping import GENERAL, merged_role
from suite.drive.patches.build.ports import ContentRow, SiteContentSource, SiteContentTarget
from suite.drive.patches.build.titles import SiblingTitles

DOCTYPE = "Drawing"
MIME = "frappe/drawing"
BACKUP_CONFIG_KEY = "draw_adoption_backup"
PAGE_SIZE = 100


def execute() -> None:
    """Adopt drawings atomically, without committing the patch transaction."""
    if not frappe.db.table_exists(DOCTYPE):
        return
    pending = frappe.db.count(DOCTYPE, {"node": ["is", "not set"]})
    shares = frappe.db.count("DocShare", {"share_doctype": DOCTYPE})
    if not frappe.db.count(DOCTYPE) and not shares:
        return
    if (pending or shares) and not str(frappe.conf.get(BACKUP_CONFIG_KEY) or "").strip():
        raise frappe.ValidationError(
            _(
                "Back up this site and record the backup path in draw_adoption_backup before adopting drawings."
            )
        )
    savepoint = f"draw_adoption_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        DrawingAdoption().run()
    except Exception as error:
        from suite.drive import rollback_savepoint

        rollback_savepoint(savepoint, error)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


class DrawingAdoption:
    """Reuse Drive's root and orphan mapping rules without legacy Build state."""

    def __init__(self):
        self.content = SiteContentSource()
        self.content_target = SiteContentTarget()
        self.journal = DocSharePreimageJournal.for_site()
        self.managers = set(
            frappe.get_all(
                "Has Role",
                filters={"role": "System Manager", "parenttype": "User"},
                pluck="parent",
            )
        ) - {"Administrator", "Guest"}

    def run(self) -> None:
        after = ""
        while rows := frappe.get_all(
            DOCTYPE, filters={"name": [">", after]}, pluck="name", order_by="name asc", limit=PAGE_SIZE
        ):
            for name in rows:
                self._adopt(name)
            after = rows[-1]
        self._convert_shares()

    def now(self) -> str:
        return now()

    def new_id(self) -> str:
        return frappe.generate_hash(length=10)

    def _adopt(self, name: str) -> None:
        fields = ["name", "node", "title", "owner", "creation", "modified", "modified_by"]
        stored = frappe.db.get_value(DOCTYPE, name, fields, as_dict=True, for_update=True)
        if not stored:
            raise frappe.ValidationError(
                _("A drawing disappeared during adoption. Keep the site in maintenance mode.")
            )
        row = ContentRow(doctype=DOCTYPE, **stored)
        nodes = self.content_target.content_nodes(DOCTYPE, name)
        if row.node:
            if (
                len(nodes) != 1
                or nodes[0]["name"] != row.node
                or nodes[0]["kind"] != "document"
                or nodes[0]["mime"] != MIME
            ):
                raise frappe.ValidationError(
                    _("Drawing {0} has an inconsistent Drive identity.").format(name)
                )
            return
        if nodes or self.content_target.nodes((name,)):
            raise frappe.ValidationError(
                _("Drawing {0} collides with an existing Drive identity.").format(name)
            )
        if not row.owner or row.owner == "Guest" or self.content.user_enabled(row.owner) is None:
            raise frappe.ValidationError(_("Drawing {0} has no valid owner for adoption.").format(name))
        root = _ensure_personal_root(self, row.owner)
        titles = SiblingTitles(
            {child["title"] for child in self.content_target.child_nodes(root) if child["state"] == "Active"}
        )
        title = titles.claim((row.title or "").strip() or name)
        node = expected_node(row, name=name, title=title, parent=root, root=root, path="", mime=MIME)
        self.content_target.write_orphan(node, DOCTYPE, name)
        for user in self.managers | {row.owner}:
            if user != "Administrator":
                self._grant(name, user, MANAGE)

    def _convert_shares(self) -> None:
        while rows := frappe.get_all(
            "DocShare",
            filters={"share_doctype": DOCTYPE},
            fields=list(DOCSHARE_COLUMNS),
            order_by="name asc",
            limit=PAGE_SIZE,
        ):
            for row in rows:
                nodes = self.content_target.content_nodes(DOCTYPE, row.share_name)
                if len(nodes) != 1:
                    raise frappe.ValidationError(_("A drawing share has no unambiguous Drive node."))
                role = docshare_role(row)
                if role is not None:
                    principal = GENERAL if row.everyone else row.user
                    self._grant(nodes[0]["name"], principal, role)
                self.journal.append(dict(row), created_at=self.now())
                self.content_target.delete_docshare(row.name)

    def _grant(self, node: str, principal: str, role: int) -> None:
        if principal == "Administrator":
            return
        if principal != GENERAL and (
            not principal
            or validate_email_address(principal) != principal
            or self.content.user_enabled(principal) is None
        ):
            raise frappe.ValidationError(
                _("A legacy drawing grant names an unsupported user. Review it before adoption.")
            )
        key = (node, principal)
        stored = self.content_target.grant_pairs((key,))
        if key not in stored:
            self.content_target.insert_grants([_grant_row(self, node, principal, role)])
        else:
            wanted = merged_role(stored[key], role)
            if wanted != stored[key]:
                self.content_target.set_grant_role(node, principal, wanted)
