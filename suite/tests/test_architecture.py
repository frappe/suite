import ast
import unittest
from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from suite import drive

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SUITE_ROOT = REPOSITORY_ROOT / "suite"
PRODUCTS = frozenset({"calendar", "drive", "mail", "meet", "sheets", "slides", "writer"})
CONTENT_PRODUCTS = frozenset({"sheets", "slides", "writer"})


@dataclass(frozen=True)
class Debt:
    owner: str
    removal: str


@dataclass(frozen=True)
class Violation:
    path: str
    line: int
    kind: str
    module: str
    reason: str

    @property
    def base_key(self):
        return f"{self.path}|{self.kind}|{self.module}"


def _debt(owner, removal, entries):
    debt = Debt(owner, removal)
    return {entry: debt for entry in entries}


BASELINE_DEBT = {
    **_debt(
        "Suite Slides",
        "Remove with the Slides Drive adapter (18) and the legacy compatibility ticket (23).",
        (
            "suite/slides/doctype/presentation/patches/integrate_with_drive.py"
            "|drive-table-write|Drive Permission",
            "suite/slides/doctype/presentation/presentation.py|drive-table-write|Drive Permission",
            "suite/slides/tests/test_pasted_media.py|drive-table-write|Drive Permission",
            "suite/slides/tests/utils.py|drive-table-write|Drive Permission",
            "suite/slides/tests/utils.py|drive-table-write|Drive Permission#2",
        ),
    ),
    **_debt(
        "Suite Drive and Meet",
        "Replace with the Suite Admin root-administration route once HTTP root workflows land (21).",
        ("suite/meet/api/test/test_recording.py|drive-table-write|Drive Root",),
    ),
    **_debt(
        "Drive and adopting product owners",
        "Remove through Drive implementation tickets 15-23 and the backend integration review (30).",
        (
            "suite/drive/api/list.py|import|suite.slides.doctype.presentation.presentation",
            "suite/hooks.py|dotted-string|suite.drive.utils.overrides.filter_file",
            "suite/hooks.py|dotted-string|suite.drive.utils.overrides.filter_drive_permission",
            "suite/hooks.py|dotted-string|suite.drive.utils.overrides.filter_drive_settings",
            "suite/hooks.py|dotted-string|suite.drive.utils.overrides.filter_drive_invitation",
            "suite/hooks.py|dotted-string|suite.drive.utils.overrides.filter_activity_log",
            "suite/hooks.py|dotted-string|suite.drive.utils.overrides.filter_drive_favourite",
            "suite/hooks.py|dotted-string|suite.drive.utils.overrides.filter_drive_recent",
            "suite/hooks.py|dotted-string|suite.drive.utils.overrides.filter_drive_notif",
            "suite/hooks.py|dotted-string|suite.drive.api.permissions.user_has_permission",
            "suite/hooks.py|dotted-string|suite.drive.api.permissions.drive_permission_has_permission",
            "suite/hooks.py|dotted-string|suite.drive.api.permissions.activity_log_has_permission",
            "suite/hooks.py|dotted-string|suite.drive.api.permissions.drive_settings_has_permission",
            "suite/hooks.py|dotted-string|suite.drive.api.permissions.drive_invitation_has_permission",
            "suite/hooks.py|dotted-string|suite.drive.overrides.file.File",
            "suite/hooks.py|dotted-string|suite.drive.utils.clear_user_group_cache",
            "suite/hooks.py|dotted-string|suite.drive.utils.clear_user_group_cache#2",
            "suite/hooks.py|dotted-string|suite.drive.overrides.file.sync_content_file",
            "suite/hooks.py|dotted-string|suite.drive.overrides.file.sync_content_file#2",
            "suite/hooks.py|dotted-string|suite.drive.overrides.file.sync_content_file#3",
            "suite/hooks.py|dotted-string|suite.drive.overrides.file.sync_content_file#4",
            "suite/hooks.py|dotted-string|suite.drive.api.scripts.auto_delete_from_trash",
            "suite/hooks.py|dotted-string|suite.drive.api.scripts.clear_deleted_files",
            "suite/hooks.py|dotted-string|suite.drive.api.scripts.clear_download_archives",
            "suite/hooks.py|dotted-string|suite.drive.webdav.locks.purge_expired_locks",
            "suite/hooks.py|dotted-string|suite.drive.overrides.file.after_file_upload",
            "suite/hooks.py|dotted-string|suite.drive.api.product.after_request",
            "suite/hooks.py|dotted-string|suite.drive.webdav.dispatch.handle_before_request",
            "suite/meet/api/recording.py|import|suite.drive.utils",
            "suite/meet/api/test/test_recording_reliability.py|import|suite.drive.api.files",
            "suite/meet/api/test/test_recording_reliability.py|import|suite.drive.utils",
            "suite/meet/api/test/test_recording_reliability.py|import|suite.drive.utils.files",
            "suite/meet/recording/ingest.py|import|suite.drive.utils",
            "suite/meet/recording/ingest.py|import|suite.drive.utils.files",
            "suite/sheets/api.py|import|suite.drive.api.permissions",
            "suite/sheets/doctype/sheet/sheet.py|import|suite.drive.overrides.file",
            "suite/sheets/patches/integrate_with_drive.py|import|suite.drive.utils",
            "suite/slides/api/test_file.py|import|suite.drive.overrides.file",
            "suite/slides/doctype/presentation/patches/integrate_with_drive.py|import|suite.drive.utils",
            "suite/slides/doctype/presentation/presentation.py|import|suite.drive.api.permissions",
            "suite/slides/doctype/presentation/presentation.py|import|suite.drive.overrides.file",
            "suite/slides/doctype/presentation/presentation.py|import|suite.drive.overrides.file#2",
            "suite/slides/tests/test_pasted_media.py|import|suite.drive.overrides.file",
            "suite/slides/tests/utils.py|import|suite.drive.overrides.file",
            "suite/slides/tests/utils.py|import|suite.drive.overrides.file#2",
            "suite/writer/api/docs.py|import|suite.drive.api.files",
            "suite/writer/api/docs.py|import|suite.drive.api.permissions",
            "suite/writer/api/docs.py|import|suite.drive.utils",
            "suite/writer/api/docs.py|import|suite.drive.utils.files",
            "suite/writer/api/embed.py|import|suite.drive.api.files",
            "suite/writer/api/embed.py|import|suite.drive.api.permissions",
            "suite/writer/api/general.py|import|suite.drive.api.permissions",
            "suite/writer/api/general.py|import|suite.drive.utils",
            "suite/writer/doctype/writer_document/writer_document.py|import|suite.drive.api.notifications",
            "suite/writer/overrides/__init__.py|import|suite.drive.api.permissions",
            "suite/writer/overrides/__init__.py|import|suite.drive.overrides.file",
        ),
    ),
    **_debt(
        "Suite Writer",
        "Remove when tickets 21 and 22 expose root, trash, media, and version workflows over HTTP.",
        (
            "suite/writer/tests/test_drive_adoption.py|dotted-string|suite.drive._core.content.spec_for",
            "suite/writer/tests/test_drive_adoption.py|dotted-string|suite.drive._core.previews.enqueue_render",
            "suite/writer/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.doc_has_permission",
            "suite/writer/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.doc_query_conditions",
            "suite/writer/tests/test_drive_adoption.py|import|suite.drive._core.access",
            "suite/writer/tests/test_drive_adoption.py|import|suite.drive._core.content",
            "suite/writer/tests/test_drive_adoption.py|import|suite.drive._core.errors",
            "suite/writer/tests/test_drive_adoption.py|import|suite.drive._core.nodes",
            "suite/writer/tests/test_drive_adoption.py|import|suite.drive._core.principals",
            "suite/writer/tests/test_drive_adoption.py|import|suite.drive._core.roots",
            "suite/writer/tests/test_drive_adoption.py|import|suite.drive._core.versions",
            "suite/writer/tests/test_drive_adoption.py|import|suite.drive.framework",
        ),
    ),
    **_debt(
        "Suite Slides",
        "Remove when tickets 21 and 22 expose root, trash, media, and version workflows over HTTP.",
        (
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive._core.content._build_registry",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive._core.content._build_registry#2",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive._core.content.spec_for",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive._core.previews.copy_preview",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive._core.previews.enqueue_render",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive._core.previews.enqueue_render#2",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.doc_has_permission",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.doc_query_conditions",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.satellite_has_permission",
            "suite/slides/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.satellite_query_conditions",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive._core.access",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive._core.content",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive._core.content#2",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive._core.errors",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive._core.nodes",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive._core.principals",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive._core.roots",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive._core.versions",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive.framework",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive.overrides.file",
            "suite/slides/tests/test_drive_adoption.py|import|suite.drive.overrides.file#2",
        ),
    ),
    **_debt(
        "Suite Sheets",
        "Remove when tickets 21 and 22 expose root, trash, media, and version workflows over HTTP.",
        (
            "suite/sheets/tests/test_drive_adoption.py|dotted-string|suite.drive._core.previews.enqueue_render",
            "suite/sheets/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.doc_has_permission",
            "suite/sheets/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.doc_query_conditions",
            "suite/sheets/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.satellite_has_permission",
            "suite/sheets/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.satellite_has_permission#2",
            "suite/sheets/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.satellite_query_conditions",
            "suite/sheets/tests/test_drive_adoption.py|dotted-string|suite.drive.framework.satellite_query_conditions#2",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive._core.access",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive._core.content",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive._core.content#2",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive._core.errors",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive._core.nodes",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive._core.principals",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive._core.roots",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive._core.versions",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive.framework",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive.overrides.file",
            "suite/sheets/tests/test_drive_adoption.py|import|suite.drive.overrides.file#2",
        ),
    ),
    **_debt(
        "Mail and Calendar owners",
        "Replace the existing Mail/Calendar cycle with declared package interfaces after the Drive rewrite.",
        (
            "suite/calendar/api/__init__.py|import|suite.mail.jmap",
            "suite/calendar/api/__init__.py|import|suite.mail.utils.dt",
            "suite/calendar/api/invites.py|import|suite.mail.jmap",
            "suite/calendar/api/invites.py|import|suite.mail.jmap.services.calendars.calendar",
            "suite/calendar/api/invites.py|import|suite.mail.jmap.services.calendars.calendar_event",
            "suite/calendar/api/rsvp.py|import|suite.mail.doctype.user_account.user_account",
            "suite/calendar/api/rsvp.py|import|suite.mail.jmap",
            "suite/calendar/api/rsvp.py|import|suite.mail.jmap.services.calendars.calendar_event",
            "suite/calendar/doctype/calendar/calendar.py|import|suite.mail.doctype.user_account.user_account",
            "suite/calendar/doctype/calendar/calendar.py|import|suite.mail.jmap",
            "suite/calendar/doctype/calendar_event/calendar_event.py|import|suite.mail.doctype.user_account.user_account",
            "suite/calendar/doctype/calendar_event/calendar_event.py|import|suite.mail.jmap",
            "suite/calendar/doctype/calendar_event/calendar_event.py|import|suite.mail.jmap.services.calendars.calendar_event",
            "suite/calendar/doctype/calendar_event/calendar_event.py|import|suite.mail.utils",
            "suite/calendar/doctype/calendar_event/calendar_event.py|import|suite.mail.utils.dt",
            "suite/calendar/doctype/calendar_event/calendar_event.py|import|suite.mail.utils.logger",
            "suite/calendar/doctype/calendar_event/invitations.py|import|suite.mail.doctype.mail_queue.mail_queue",
            "suite/calendar/doctype/calendar_event/invitations.py|import|suite.mail.doctype.user_account.user_account",
            "suite/calendar/doctype/calendar_event/invitations.py|import|suite.mail.jmap",
            "suite/calendar/doctype/calendar_event/mailing_lists.py|import|suite.mail.stalwart",
            "suite/calendar/doctype/calendar_event/mailing_lists.py|import|suite.mail.utils",
            "suite/calendar/doctype/calendar_exchange/calendar_exchange.py|import|suite.mail.doctype.push_subscription.push_subscription",
            "suite/calendar/doctype/calendar_exchange/calendar_exchange.py|import|suite.mail.doctype.user_account.user_account",
            "suite/calendar/doctype/calendar_exchange/calendar_exchange.py|import|suite.mail.jmap",
            "suite/calendar/doctype/calendar_exchange/calendar_exchange.py|import|suite.mail.jmap.services.calendars.calendar",
            "suite/calendar/doctype/calendar_exchange/calendar_exchange.py|import|suite.mail.jmap.services.calendars.calendar_event",
            "suite/calendar/doctype/calendar_exchange/calendar_exchange.py|import|suite.mail.utils",
            "suite/calendar/doctype/calendar_exchange/calendar_exchange.py|import|suite.mail.utils.logger",
            "suite/calendar/doctype/calendar_exchange/calendar_exchange.py|import|suite.mail.utils.user",
            "suite/calendar/doctype/event_notification/event_notification.py|import|suite.mail.doctype.user_account.user_account",
            "suite/calendar/doctype/event_notification/event_notification.py|import|suite.mail.jmap",
            "suite/calendar/doctype/event_notification/event_notification.py|import|suite.mail.utils.dt",
            "suite/calendar/tests/test_calendar_calendars.py|import|suite.mail.tests.base",
            "suite/calendar/tests/test_calendar_events.py|import|suite.mail.tests.base",
            "suite/calendar/tests/test_calendar_exchange_and_notifications.py|import|suite.mail.api.account",
            "suite/calendar/tests/test_calendar_exchange_and_notifications.py|import|suite.mail.tests.base",
            "suite/calendar/tests/test_calendar_invites_rsvp.py|import|suite.mail.tests.base",
            "suite/calendar/tests/test_calendar_invites_rsvp.py|import|suite.mail.jmap",
            "suite/calendar/tests/test_calendar_mail_invites.py|import|suite.mail.api.mail",
            "suite/calendar/tests/test_calendar_mail_invites.py|import|suite.mail.tests.base",
            "suite/calendar/tests/test_calendar_mailing_list_participants.py|import|suite.mail.api.admin",
            "suite/calendar/tests/test_calendar_mailing_list_participants.py|import|suite.mail.stalwart",
            "suite/calendar/tests/test_calendar_mailing_list_participants.py|import|suite.mail.tests.base",
            "suite/mail/api/jmap.py|import|suite.calendar.doctype.calendar_event.calendar_event",
            "suite/mail/tests/test_jmap_calendar_event_notification.py|import|suite.calendar.doctype.event_notification.event_notification",
            "suite/mail/utils/query.py|import|suite.calendar.doctype.calendar.calendar",
        ),
    ),
    **_debt(
        "Meet, Mail, and Calendar owners",
        "Declare scheduling interfaces before changing the existing Meet integration.",
        (
            "suite/meet/api/schedule.py|import|suite.calendar.doctype.calendar_event.calendar_event",
            "suite/meet/api/schedule.py|import|suite.mail.doctype.user_account.user_account",
        ),
    ),
    **_debt(
        "Suite architecture",
        "Move Suite-level orchestration behind composition-owned interfaces.",
        (
            "suite/api/account.py|import|suite.mail.utils.user",
            "suite/tests/ci_smoke.py|dotted-string|suite.meet.api.recording.reconcile_pending_recordings",
            "suite/www/event_rsvp.py|import|suite.calendar.api.rsvp",
        ),
    ),
}


def _owner(path):
    parts = PurePosixPath(path).parts
    if (
        len(parts) > 1
        and parts[0] == "suite"
        and parts[1]
        in PRODUCTS
        | {
            "composition",
            "suite_core",
        }
    ):
        return parts[1]
    return None


def _classify(path, module):
    parts = module.split(".")
    if len(parts) < 2 or parts[0] != "suite" or parts[1] not in PRODUCTS | {"suite_core"}:
        return None

    source = _owner(path)
    target = parts[1]
    if source == "composition":
        return None
    if source == "drive" and target in CONTENT_PRODUCTS:
        return "Drive imports a concrete content-product implementation"
    if source == "suite_core" and target in PRODUCTS:
        return "suite_core imports a product implementation"
    if source in PRODUCTS and target in PRODUCTS and source != target:
        if module == f"suite.{target}":
            return None
        return "a product imports another product below its package-root interface"
    if target == "drive" and source != "drive":
        if module == "suite.drive":
            return None
        if path == "suite/hooks.py" and module.startswith(("suite.drive.framework.", "suite.drive.jobs.")):
            return None
        return "code outside Drive imports a private Drive module"
    if source is None and path != "suite/hooks.py" and target in PRODUCTS:
        if module != f"suite.{target}":
            return "Suite-level code imports a product below its package-root interface"
    return None


DRIVE_TABLE_WRITE_CALLS = frozenset(
    {
        "frappe.db.set_value",
        "frappe.db.set_single_value",
        "frappe.db.delete",
        "frappe.db.bulk_insert",
        "frappe.delete_doc",
        "frappe.new_doc",
        "frappe.rename_doc",
    }
)
DRIVE_TABLE_WRITE_REASON = "code outside Drive writes a Drive table directly"


def _dotted_call_name(node):
    parts = []
    current = node.func
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if not isinstance(current, ast.Name):
        return None
    parts.append(current.id)
    return ".".join(reversed(parts))


def _drive_doctype_argument(node):
    """Return the Drive DocType a call writes to, or None."""
    name = _dotted_call_name(node)
    if not name or not node.args:
        return None
    first = node.args[0]
    if name in DRIVE_TABLE_WRITE_CALLS:
        if isinstance(first, ast.Constant) and str(first.value).startswith("Drive "):
            return first.value
        return None
    if name in ("frappe.get_doc", "frappe.new_doc") and isinstance(first, ast.Dict):
        for key, value in zip(first.keys, first.values, strict=True):
            if (
                isinstance(key, ast.Constant)
                and key.value == "doctype"
                and isinstance(value, ast.Constant)
                and str(value.value).startswith("Drive ")
            ):
                return value.value
        return None
    if name == "frappe.db.sql" and isinstance(first, ast.Constant):
        statement = str(first.value).strip().split(None, 1)[0].upper() if first.value.strip() else ""
        if statement in ("UPDATE", "INSERT", "DELETE", "REPLACE") and "tabDrive " in first.value:
            return "tabDrive"
    return None


def table_write_violations(path, tree):
    """Enforce ARCHITECTURE.md rule 5.5 for every caller outside Drive."""
    if PurePosixPath(path).parts[:2] == ("suite", "drive"):
        return []
    violations = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        doctype = _drive_doctype_argument(node)
        if doctype:
            violations.append(
                Violation(path, node.lineno, "drive-table-write", doctype, DRIVE_TABLE_WRITE_REASON)
            )
    return violations


def _modules(node):
    if isinstance(node, ast.Import):
        return ("import", [alias.name for alias in node.names])
    if isinstance(node, ast.ImportFrom):
        if node.module == "suite":
            return ("import", [f"suite.{alias.name}" for alias in node.names])
        return ("import", [node.module] if node.module else [])
    if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.startswith("suite."):
        return ("dotted-string", [node.value])
    return (None, [])


def violations_in_tree(path, tree):
    violations = []
    for node in ast.walk(tree):
        kind, modules = _modules(node)
        for module in modules:
            reason = _classify(path, module)
            if reason:
                violations.append(Violation(path, node.lineno, kind, module, reason))
    violations.extend(table_write_violations(path, tree))
    return sorted(
        violations, key=lambda violation: (violation.path, violation.line, violation.kind, violation.module)
    )


def python_violations():
    violations = []
    for source in sorted(SUITE_ROOT.rglob("*.py")):
        relative = source.relative_to(REPOSITORY_ROOT).as_posix()
        if relative == "suite/tests/test_architecture.py":
            continue
        tree = ast.parse(source.read_text(), filename=relative)
        violations.extend(violations_in_tree(relative, tree))
    return violations


def keyed_violations(violations):
    counts = Counter()
    keyed = {}
    for violation in violations:
        counts[violation.base_key] += 1
        occurrence = counts[violation.base_key]
        key = violation.base_key if occurrence == 1 else f"{violation.base_key}#{occurrence}"
        keyed[key] = violation
    return keyed


class TestArchitecture(unittest.TestCase):
    def test_python_boundaries_match_owned_debt_baseline(self):
        actual = keyed_violations(python_violations())
        unexpected = sorted(set(actual) - set(BASELINE_DEBT))
        resolved = sorted(set(BASELINE_DEBT) - set(actual))
        details = []
        if unexpected:
            details.append(
                "New boundary violations:\n"
                + "\n".join(f"  {key} (line {actual[key].line}: {actual[key].reason})" for key in unexpected)
            )
        if resolved:
            details.append(
                "Resolved debt still present in BASELINE_DEBT:\n"
                + "\n".join(f"  {key} (owner: {BASELINE_DEBT[key].owner})" for key in resolved)
            )
        self.assertFalse(details, "\n\n".join(details))

    def test_forbidden_static_and_dynamic_imports_are_detected(self):
        tree = ast.parse(
            "from suite.drive._core.access import require\n"
            "target = 'suite.drive.doctype.drive_node.drive_node.DriveNode'\n"
        )
        violations = violations_in_tree("suite/writer/new_caller.py", tree)
        self.assertEqual(len(violations), 2)
        self.assertTrue(all("package-root interface" in violation.reason for violation in violations))

    def test_drive_table_writes_outside_drive_are_detected(self):
        source = (
            "frappe.db.set_value('Drive Root', root, 'used_bytes', 1)\n"
            "frappe.db.delete('Drive Grant', {'node': node})\n"
            "frappe.get_doc({'doctype': 'Drive Storage Reservation', 'root': root}).insert()\n"
            "frappe.new_doc('Drive Node')\n"
            "frappe.db.sql('UPDATE `tabDrive Root` SET used_bytes = 0')\n"
        )
        violations = violations_in_tree("suite/meet/new_caller.py", ast.parse(source))
        self.assertEqual([violation.kind for violation in violations], ["drive-table-write"] * 5)
        self.assertTrue(all(DRIVE_TABLE_WRITE_REASON == v.reason for v in violations))

    def test_drive_reads_and_drive_owned_writes_are_allowed(self):
        source = (
            "frappe.db.get_value('Drive Root', root, 'used_bytes')\n"
            "frappe.get_all('Drive Node', filters={'root': root})\n"
            "frappe.db.sql('SELECT name FROM `tabDrive Node`')\n"
            "frappe.db.count('Drive Storage Reservation', {'root': root})\n"
        )
        self.assertEqual(violations_in_tree("suite/meet/new_caller.py", ast.parse(source)), [])
        write = "frappe.db.delete('Drive Grant', {'node': node})\n"
        self.assertEqual(violations_in_tree("suite/drive/_core/roots.py", ast.parse(write)), [])

    def test_package_root_import_is_allowed(self):
        tree = ast.parse("from suite import drive\n")
        self.assertEqual(violations_in_tree("suite/writer/new_caller.py", tree), [])

    def test_drive_public_interface_is_explicit_and_complete_only(self):
        self.assertIsInstance(drive.__all__, tuple)
        self.assertEqual(
            drive.__all__,
            (
                "COMMENT",
                "EDIT",
                "MANAGE",
                "READ",
                "UPLOAD",
                "ContentTypeSpec",
                "DriveContent",
        "DriveError",
                "Satellite",
                "adopt_media",
                "bind_legacy_storage_reservation",
                "check",
                "copy",
                "create_document",
                "create_storage_reservation",
                "ensure_personal_root",
                "get_storage_reservation",
                "get_storage_usage",
                "grow_storage_reservation",
                "import_document",
                "personal_root_for",
                "push_preview",
                "read_file",
                "reduce_storage_reservation",
                "refuse_shared_linked_rows",
                "refuse_shared_row",
                "release_storage_reservation",
                "take_version",
                "touch",
            ),
        )
        for name in drive.__all__:
            self.assertTrue(getattr(drive, name, None), name)
        self.assertIn("## Content apps", drive.__doc__)
        self.assertIn("## Errors", drive.__doc__)
        self.assertIn("## Transactions", drive.__doc__)
        self.assertIn("## Permissions", drive.__doc__)
        self.assertIn("## Performance", drive.__doc__)

    def test_every_baseline_entry_has_a_removal_owner(self):
        for key, debt in BASELINE_DEBT.items():
            with self.subTest(key=key):
                self.assertTrue(debt.owner)
                self.assertTrue(debt.removal)
