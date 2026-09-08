from . import __version__ as app_version

# ============================================================================
# App metadata (Suite)
# ============================================================================
app_name = "suite"
app_title = "Frappe Suite"
app_publisher = "Frappe"
app_description = "Frappe Suite"
app_email = "developers@frappe.io"
app_license = "agpl-3.0"

# ============================================================================
# Apps screen / App switcher
# ============================================================================
add_to_apps_screen = [
    {
        "name": "suite",
        "logo": "/assets/suite/frontend/logo.svg",
        "title": "Frappe Suite",
        "route": "/suite",
    },
]

# ============================================================================
# Includes
# ============================================================================
# drive
app_include_js = ["ff_integration.bundle.js"]

# drive — include js in doctype views (File form tweaks)
doctype_js = {"File": "public/js/file.js"}

# mail — email-specific Tailwind CSS for email template rendering
email_css = ["/assets/suite/mail/css/email.css"]

# writer — SQLite full-text search provider
sqlite_search = ["suite.writer.search.WriterSearch"]

# ============================================================================
# Website routing (concatenated from all apps)
# ============================================================================
# Unified SPA: every former-app prefix serves the single suite bootstrap
# (www/suite.py -> suite.html); Vue Router takes over client-side. (plan D9)
# Both the bare prefix and the sub-path are mapped so deep links + launcher
# links (which use the bare prefix) both hit the SPA on first load.
website_route_rules = [
    {"from_route": "/suite/<path:app_path>", "to_route": "suite"},
    {"from_route": "/drive", "to_route": "suite"},
    # drive — the share-link landing page (§11.2). It must be declared before
    # the catch-all below is read, although werkzeug would rank it first
    # anyway: a `<path:>` converter is the least specific rule in a Map.
    {"from_route": "/drive/l/<token>", "to_route": "drive_link"},
    {"from_route": "/drive/<path:app_path>", "to_route": "suite"},
    {"from_route": "/slides", "to_route": "suite"},
    {"from_route": "/slides/<path:app_path>", "to_route": "suite"},
    {"from_route": "/sheets", "to_route": "suite"},
    {"from_route": "/sheets/<path:app_path>", "to_route": "suite"},
    {"from_route": "/writer", "to_route": "suite"},
    {"from_route": "/writer/<path:app_path>", "to_route": "suite"},
    {"from_route": "/mail", "to_route": "suite"},
    {"from_route": "/mail/<path:app_path>", "to_route": "suite"},
    {"from_route": "/meet", "to_route": "suite"},
    {"from_route": "/meet/<path:app_path>", "to_route": "suite"},
    {"from_route": "/calendar", "to_route": "suite"},
    {"from_route": "/calendar/<path:app_path>", "to_route": "suite"},
]

home_page = "suite"

# mail — website redirects
website_redirects = [
    {
        "source": "/auth/validate",
        "target": "/api/method/suite.mail.api.auth.validate",
        "redirect_http_status": 307,
    },
    {
        "source": "/outbound/upload",
        "target": "/api/method/suite.mail.api.outbound.upload_attachment",
        "redirect_http_status": 307,
    },
    {
        "source": "/outbound/send",
        "target": "/api/method/suite.mail.api.outbound.send",
        "redirect_http_status": 307,
    },
    {
        "source": "/outbound/send-raw",
        "target": "/api/method/suite.mail.api.outbound.send_raw",
        "redirect_http_status": 307,
    },
    {
        "source": "/inbound/blob",
        "target": "/api/method/suite.mail.api.inbound.fetch_blob",
        "redirect_http_status": 307,
    },
    {
        "source": "/inbound/pull",
        "target": "/api/method/suite.mail.api.inbound.pull",
        "redirect_http_status": 307,
    },
    {
        "source": "/inbound/pull-raw",
        "target": "/api/method/suite.mail.api.inbound.pull_raw",
        "redirect_http_status": 307,
    },
    {
        "source": "/spamd/scan",
        "target": "/api/method/suite.mail.api.spamd.scan",
        "redirect_http_status": 307,
    },
    {
        "source": "/spamd/score",
        "target": "/api/method/suite.mail.api.spamd.get_spam_score",
        "redirect_http_status": 307,
    },
]

# Framework File permission logic is fully replaced by Drive's
ignore_file_permissions = True

# ============================================================================
# Drive content types (§10.3)
# ============================================================================
# Dotted paths to `suite.drive.ContentTypeSpec` objects, one per content app.
# Registration is staged: an app declares its spec in its own adoption ticket
# and joins this list only once every row of its doctype carries a `node`
# Link. Ticket 29 does that here, together with the `has_permission` and
# `permission_query_conditions` entries below. The three changes land in one
# commit because the framework reads the registry and both hook maps.
#
# Writer declares `suite.writer.drive.SPEC` (ticket 17), Slides declares
# `suite.slides.drive.SPEC` (ticket 18), and Sheets declares
# `suite.sheets.drive.SPEC` (ticket 19). All three are listed now.
#
# **What proves the links exist.** `validate_content_registry` runs on
# `after_migrate`, and `suite.drive.patches.build` is the last line of
# `patches.txt`, so Build has written every node link before the registry is
# checked. `refuse_unlinked_documents` counts the rows that still have none
# and stops the migration naming the doctype, so an incomplete Build cannot
# leave a document nobody can read (§5.13, README "stage content registry
# activation after required node links exist").
#
# On activation each doctype needs an open baseline role DocPerm, because a
# Frappe permission hook can only deny (`frappe/permissions.py:244-246`);
# `Writer Document` and `Presentation` both carry the open `All` row §10.4
# requires, and a `Guest` read row for link grants. Both are preserved as they
# are; widening or narrowing one is an activation decision, not this one's.
#
# `Sheet` carried an `if_owner` `All` row instead, so ticket 19 widened it to the
# open baseline §10.4 needs and put the owner rule into
# `suite.sheets.permissions.sheet_has_permission`. `doc_has_permission` answers
# that row now, and the owner reaches it through the MANAGE grant Build wrote on
# their own node. The row is kept as ticket 19 left it: it carries `share`,
# `export`, `print`, `email`, and `report`, because a hook can only deny and a
# right the row does not carry is a right no hook can hand back. `share_sheet`
# asks `ptype="share"` and `frappe.share.check_share_permission` asks it again.
# Its `Guest` read row is there for link grants.
#
# `suite/sheets/permissions.py` still defines `sheet_has_permission`,
# `sheet_query_conditions`, and the two `sheet_op_log_*` guards. No hook names
# them from here any more. Ticket 35 deletes the module with the doctypes it
# reads; only `sheet_snapshot_*` is still wired, below.
#
# `Presentation` still owns the legacy `title` column §14.7 read at Build and
# §14.10 drops at Cleanup, one release after activation. `suite.slides.drive.SPEC`
# declares it in `legacy_fields`, so activation exempts it from §10.2 and freezes
# it instead: nothing reads it, nothing may write it, and the Build value stays
# for the §14.11 rollback. Ticket 29 has no column to drop first. `Sheet` does
# the same for `title`, `trashed`, `trashed_on`, and `trashed_by`.
#
# **Three legacy guards stay past activation**, against §10.4's deletion list.
# `Writer Template`, `Writer Version`, and `Sheet Snapshot` are Build sources
# §14.10 drops at Cleanup, one release later, so their rows outlive activation
# and Drive governs none of them: no `ContentTypeSpec` declares them, as a
# doctype or as a satellite. Their role rows are open (`Suite User` on the two
# Writer doctypes, `All` read on `Sheet Snapshot`), and a Frappe permission
# hook can only deny, so deleting the guards would publish every migrated
# template, version, and snapshot to every signed-in user. §10.4 is the
# post-Cleanup end state, which is the same reading §10.7 states in as many
# words: "App must delete ... `Writer Version` ... `Writer Template` ...
# `filter_templates` and `template_has_permission`". Ticket 35 deletes the
# guards with the doctypes they read.
drive_content_types = [
    "suite.writer.drive.SPEC",
    "suite.slides.drive.SPEC",
    "suite.sheets.drive.SPEC",
]

# ============================================================================
# Permissions — permission_query_conditions (deep-merged union; no key clashes)
# ============================================================================
permission_query_conditions = {
    # drive
    "File": "suite.drive.utils.overrides.filter_file",
    "Drive Permission": "suite.drive.utils.overrides.filter_drive_permission",
    "Drive Settings": "suite.drive.utils.overrides.filter_drive_settings",
    "Drive User Invitation": "suite.drive.utils.overrides.filter_drive_invitation",
    "Drive Entity Activity Log": "suite.drive.utils.overrides.filter_activity_log",
    "Drive Favourite": "suite.drive.utils.overrides.filter_drive_favourite",
    "Drive Recent": "suite.drive.utils.overrides.filter_drive_recent",
    "Drive Notification": "suite.drive.utils.overrides.filter_drive_notif",
    # slides — governed by Drive (§10.4). `Slide` is the deck's satellite and
    # takes its rights from the deck's node.
    "Presentation": "suite.drive.framework.doc_query_conditions",
    "Slide": "suite.drive.framework.satellite_query_conditions",
    # writer
    # `Writer Template` and `Writer Version` are Build sources until Cleanup,
    # so their legacy guards stay; see the note above `drive_content_types`.
    "Writer Template": "suite.writer.overrides.filter_templates",
    "Writer Document": "suite.drive.framework.doc_query_conditions",
    "Writer Version": "suite.writer.overrides.version_query_conditions",
    # sheets
    "Sheet": "suite.drive.framework.doc_query_conditions",
    # `Sheet Op Log` and `Sheet Collab State` are the two satellites
    # `suite.sheets.drive.SPEC` declares. `Sheet Snapshot` keeps its own guard
    # past activation: §14.6 migrates its rows into `Drive Node Version`, so it
    # is a Build source until Cleanup drops the doctype (§14.10), and a
    # satellite declaration would freeze rows Build still has to read.
    "Sheet Op Log": "suite.drive.framework.satellite_query_conditions",
    "Sheet Collab State": "suite.drive.framework.satellite_query_conditions",
    "Sheet Snapshot": "suite.sheets.permissions.sheet_snapshot_query",
    # meet
    "Meet Room": "suite.meet.doctype.meet_room.meet_room.get_permission_query_conditions",
    "Meet Recording": "suite.meet.doctype.meet_recording.meet_recording.get_permission_query_conditions",
    # mail
    "JMAP Account": "suite.mail.doctype.jmap_account.jmap_account.get_permission_query_condition",
    "Mail Sync History": "suite.mail.doctype.mail_sync_history.mail_sync_history.get_permission_query_condition",
    "Mailbox Settings": "suite.mail.doctype.mailbox_settings.mailbox_settings.get_permission_query_condition",
    "Screened Email Address": "suite.mail.doctype.screened_email_address.screened_email_address.get_permission_query_condition",
}

# ============================================================================
# Permissions — has_permission (deep-merged union; no key clashes)
# ============================================================================
has_permission = {
    # drive
    "File": "suite.drive.api.permissions.user_has_permission",
    "Drive Permission": "suite.drive.api.permissions.drive_permission_has_permission",
    "Drive Entity Activity Log": "suite.drive.api.permissions.activity_log_has_permission",
    "Drive Settings": "suite.drive.api.permissions.drive_settings_has_permission",
    "Drive User Invitation": "suite.drive.api.permissions.drive_invitation_has_permission",
    # slides — governed by Drive (§10.4).
    "Presentation": "suite.drive.framework.doc_has_permission",
    "Slide": "suite.drive.framework.satellite_has_permission",
    # writer
    "Writer Document": "suite.drive.framework.doc_has_permission",
    # Build sources until Cleanup; see the note above `drive_content_types`.
    "Writer Version": "suite.writer.overrides.version_has_permission",
    "Writer Template": "suite.writer.overrides.template_has_permission",
    # sheets
    "Sheet": "suite.drive.framework.doc_has_permission",
    "Sheet Op Log": "suite.drive.framework.satellite_has_permission",
    "Sheet Collab State": "suite.drive.framework.satellite_has_permission",
    "Sheet Snapshot": "suite.sheets.permissions.sheet_snapshot_has_permission",
    # meet
    "Meet Room": "suite.meet.doctype.meet_room.meet_room.has_permission",
    "Meet Recording": "suite.meet.doctype.meet_recording.meet_recording.has_permission",
    # mail
    "JMAP Account": "suite.mail.doctype.jmap_account.jmap_account.has_permission",
    "Address Book": "suite.mail.doctype.address_book.address_book.has_permission",
    "Calendar": "suite.calendar.doctype.calendar.calendar.has_permission",
    "Calendar Event": "suite.calendar.doctype.calendar_event.calendar_event.has_permission",
    "Contact Card": "suite.mail.doctype.contact_card.contact_card.has_permission",
    "Event Notification": "suite.calendar.doctype.event_notification.event_notification.has_permission",
    "Identity": "suite.mail.doctype.identity.identity.has_permission",
    "Mail Sync History": "suite.mail.doctype.mail_sync_history.mail_sync_history.has_permission",
    "Mailbox": "suite.mail.doctype.mailbox.mailbox.has_permission",
    "Mailbox Settings": "suite.mail.doctype.mailbox_settings.mailbox_settings.has_permission",
    "Participant Identity": "suite.mail.doctype.participant_identity.participant_identity.has_permission",
    "Push Subscription": "suite.mail.doctype.push_subscription.push_subscription.has_permission",
    "Quota": "suite.mail.doctype.quota.quota.has_permission",
    "Screened Email Address": "suite.mail.doctype.screened_email_address.screened_email_address.has_permission",
    "Sieve Script": "suite.mail.doctype.sieve_script.sieve_script.has_permission",
    "Vacation Response": "suite.mail.doctype.vacation_response.vacation_response.has_permission",
}

# ============================================================================
# Override standard doctype classes (drive)
# ============================================================================
override_doctype_class = {
    "File": "suite.drive.overrides.file.File",
}

# ============================================================================
# Override whitelisted methods (mail)
# ============================================================================
override_whitelisted_methods = {
    "frappe.core.doctype.user.user.update_password": "suite.mail.events.update_password",
    # Auth
    "mail.api.auth.validate": "suite.mail.api.auth.validate",
    # Outbound
    "mail.api.outbound.upload_attachment": "suite.mail.api.outbound.upload_attachment",
    "mail.api.outbound.send": "suite.mail.api.outbound.send",
    "mail.api.outbound.send_raw": "suite.mail.api.outbound.send_raw",
    # Inbound
    "mail.api.inbound.fetch_blob": "suite.mail.api.inbound.fetch_blob",
    "mail.api.inbound.pull": "suite.mail.api.inbound.pull",
    "mail.api.inbound.pull_raw": "suite.mail.api.inbound.pull_raw",
    # SpamD
    "mail.api.spamd.scan": "suite.mail.api.spamd.scan",
    "mail.api.spamd.get_spam_score": "suite.mail.api.spamd.get_spam_score",
    # writer — embed URLs baked into documents created by the standalone app
    "writer.api.embed.get": "suite.writer.api.embed.get",
}

# ============================================================================
# Document Events (deep-merged; per-doctype/per-event handler lists combined)
# ============================================================================
doc_events = {
    # drive — Drive Grant is the only permission table for a registered
    # content doctype and its satellites, but a DocShare row grants around
    # both permission hooks (frappe/permissions.py:214-216 and
    # frappe/database/query.py:1739-1742). A governed doctype therefore
    # carries no share at all. Deleting a row is left alone, so a legacy share
    # can still be cleaned up. Live from ticket 29: the three content doctypes
    # and their satellites now refuse a new share, and `Writer Template`,
    # `Writer Version`, and `Sheet Snapshot` still take one.
    "DocShare": {
        "validate": ["suite.drive.framework.refuse_governed_share"],
    },
    "File": {
        "on_update": "suite.meet.recording.ingest.delete_recording_metadata_for_removed_artifact",
    },
    "User Group": {
        "on_update": "suite.drive.utils.clear_user_group_cache",
        "on_trash": "suite.drive.utils.clear_user_group_cache",
    },
    # `Presentation` and `Sheet` mirrored their title and trash state onto the
    # backing Drive `File` here. §10.4 deletes both entries at activation and
    # ticket 29 did: the node is the only truth (§10.2), `title`, `trashed`,
    # `trashed_on`, and `trashed_by` are frozen `legacy_fields` no caller may
    # write, and a governed row is trashed through Drive. The `File` row Build
    # copied stays untouched until §14.10 drops it, which is what the §14.11
    # rollback needs.
    "User": {
        # Roles are assigned before insert so they are present when Frappe's
        # User.validate runs — assigning them after insert triggers a spurious
        # "No Roles Specified" warning and leaves user_type mis-resolved.
        "before_insert": [
            "suite.utils.user.assign_suite_role",
        ],
        "after_insert": [
            "suite.composition.users.after_insert",
        ],
        "on_update": [
            "suite.mail.events.update_account_password",
            "suite.mail.events.clear_sessions_on_disable",
            "suite.mail.events.apply_disabled_account_role",
            "suite.mail.events.remove_disabled_account_role",
        ],
        "on_trash": [
            "suite.composition.users.on_trash",
        ],
    },
}

user_invitation = {
    "allowed_roles": {
        "System Manager": ["Suite User"],
    },
}

# Suite's onboarding replaces the built-in desk setup wizard
setup_wizard_url = "/suite/setup"

# ============================================================================
# Scheduled Tasks (per-frequency lists combined; cron keys de-duplicated)
# ============================================================================
scheduler_events = {
    "daily": [
        # meet
        "suite.meet.api.recording.cleanup_failed_recordings",
        # drive
        "suite.drive.jobs.recompute_root_usage",
        "suite.drive.jobs.purge_trashed_nodes",
        "suite.drive.jobs.thin_versions",
        "suite.drive.jobs.sweep_missing_previews",
        "suite.drive.jobs.sweep_unused_document_media",
        "suite.drive.api.scripts.auto_delete_from_trash",
        "suite.drive.api.scripts.clear_deleted_files",
        # sheets
        "suite.sheets.versioning.tasks.rollup_snapshots",
        "suite.sheets.versioning.tasks.truncate_op_log",
        "suite.sheets.trash.purge_trashed_sheets",
        # mail
        "suite.mail.doctype.jmap_account.jmap_account.delete_orphaned_jmap_accounts",
        "suite.mail.doctype.mail_exchange.mail_exchange.clean_import_export_directories",
        "suite.mail.doctype.push_subscription.push_subscription.renew_expiring_push_subscriptions",
        "suite.mail.doctype.contacts_exchange.contacts_exchange.clean_contacts_import_export_directories",
        "suite.calendar.doctype.calendar_exchange.calendar_exchange.clean_calendar_import_export_directories",
    ],
    "hourly": [
        # drive
        "suite.drive.api.scripts.clear_download_archives",
        "suite.drive.webdav.locks.purge_expired_locks",
        # mail
        "suite.mail.doctype.mail_exchange.mail_exchange.retry_stuck_mail_exchanges",
        "suite.calendar.doctype.calendar_exchange.calendar_exchange.retry_stuck_calendar_exchanges",
        "suite.mail.doctype.contacts_exchange.contacts_exchange.retry_stuck_contacts_exchanges",
    ],
    "cron": {
        "* * * * *": ["suite.meet.api.recording.reconcile_pending_recordings"],
        "*/5 * * * *": [
            # mail
            "suite.mail.doctype.server_job.server_job.retry_failed_jobs",
            "suite.mail.doctype.mail_queue.mail_queue.enqueue_process_pending_emails",
            "suite.mail.doctype.server_deployment.server_deployment.retry_failed_deployments",
            "suite.mail.doctype.server_ansible_play.server_ansible_play.retry_failed_ansible_plays",
        ],
    },
}

# ============================================================================
# Lifecycle hooks — dispatched through suite.composition so that EACH
# former app's handler is preserved and invoked in order.
# ============================================================================
before_install = "suite.composition.lifecycle.before_install"
after_install = "suite.composition.lifecycle.after_install"
after_migrate = "suite.composition.lifecycle.after_migrate"
after_app_install = "suite.composition.lifecycle.after_app_install"
extend_bootinfo = "suite.composition.lifecycle.extend_bootinfo"

# drive — custom upload + after_request middleware (single definers)
after_file_upload = "suite.drive.overrides.file.after_file_upload"
after_request = "suite.drive.api.product.after_request"

# drive — WebDAV protocol dispatcher, then the /api/suite/drive/ translator
# (list hook, additive). The two own disjoint prefixes: /dav and
# /api/suite/drive/. The translator is reached through suite.drive.framework,
# which is where ARCHITECTURE.md puts a Frappe dotted target that enters Drive;
# the WebDAV entry predates that rule and is carried as declared debt.
before_request = [
    "suite.drive.webdav.dispatch.handle_before_request",
    "suite.drive.framework.handle_http_request",
]

# drive — the WebDAV dispatcher consumes /dav request bodies itself (frappe skips the
# body cap and form_dict buffering; a no-op on frappe versions without this hook,
# where PUT bodies fall back to buffered and capped)
# Compatible Frappe versions consume this prefix before request form parsing so
# upload chunk bodies remain streams instead of being buffered. It fires for PUT
# only, which is why the chunk route is PUT and reads the body itself.
streaming_request_paths = ["/dav/", "/api/suite/drive/uploads/"]

# ============================================================================
# Fixtures (concatenated; identical entries de-duplicated)
# ============================================================================
fixtures = [
    # drive
    {"dt": "Custom Field", "filters": [["dt", "=", "File"]]},
    {"dt": "Property Setter", "filters": [["doc_type", "=", "File"]]},
    {"dt": "Role", "filters": [["role_name", "like", "Drive %"]]},
    # slides
    {"dt": "Presentation", "filters": [["is_template", "=", "1"]]},
    # meet
    {"dt": "Role", "filters": [["role_name", "like", "Meet %"]]},
    # mail / calendar
    {"dt": "Role", "filters": [["role_name", "like", "Suite %"]]},
]

# ============================================================================
# Misc carried-over hooks
# ============================================================================
# drive — custom signup template
signup_form_template = "templates/signup.html"

# mail — link integrity on delete
ignore_links_on_delete = [
    # drive — File.after_delete clears all of these itself, but the framework's
    # link check runs first and would refuse the delete before it gets the chance
    "Drive Settings",
    "Drive Permission",
    "Drive Favourite",
    "Drive Recent",
    "Drive Notification",
    "Drive Entity Activity Log",
    "Drive DAV Property",
    "Drive DAV Lock",
    # drive — records that link a User and outlive them. Offboarding archives
    # the Personal Root and keeps its nodes, grants, byte charges, and every
    # attributed record, so the framework's link check must not refuse the User
    # delete over any of them. suite.drive.install.on_user_trash runs first and
    # deletes the private rows (Drive Recent, Drive Favourite, Drive
    # Notification) so a recreated email inherits none of them.
    "Drive Root",
    "Drive Activity",
    "Drive Node Version",
    "Drive Comment",
    "Drive Comment Thread",
    "Drive Recent",
    "Drive Storage Reservation",
    # mail
    "Mail Account Request",
    "Server Job",
    "Server Ansible Play",
    "Server Deployment",
    "JMAP Account",
    "User Account",
    "Screened Email Address",
    "Mail Exchange",
    "Mail Queue",
    "Mail Signature",
    "Mail Sync History",
    "Mailbox Settings",
    "User Settings",
]

# mail — log retention (only definer; kept as dict)
default_log_clearing_doctypes = {"Mail Queue": 3, "Spam Check Log": 7}

export_python_type_annotations = True
require_type_annotated_api_methods = True

# ============================================================================
# Access-control path lists (concatenated; identical entries de-duplicated)
# ============================================================================
# drive
ALLOWED_PATHS = [
    "/api/method/create-site-migration",
    "/api/method/find-my-sites",
    "/api/method/frappe.realtime.get_user_info",
    "/api/method/frappe.realtime.can_subscribe_doc",
    "/api/method/frappe.realtime.can_subscribe_doctype",
    "/api/method/frappe.realtime.has_permission",
    "/api/method/frappe.www.login.login_via_frappe",
    "/api/method/frappe.integrations.oauth2.authorize",
    "/api/method/frappe.integrations.oauth2.approve",
    "/api/method/frappe.integrations.oauth2.get_token",
    "/api/method/frappe.integrations.oauth2.openid_profile",
    "/api/method/frappe.website.doctype.web_page_view.web_page_view.make_view_log",
    "/api/method/ping",
    "/api/method/login",
    "/api/method/logout",
    "/api/method/upload_file",
    "/api/method/frappe.search.web_search",
    "/api/method/frappe.email.queue.unsubscribe",
    "/api/method/frappe.website.doctype.web_form.web_form.accept",
    "/api/method/frappe.core.doctype.user.user.test_password_strength",
    "/api/method/frappe.core.doctype.user.user.update_password",
    # drive — WebDAV mount root
    "/dav",
]

ALLOWED_WILDCARD_PATHS = [
    "/api/method/frappe.integrations.oauth2_logins.",
    "/api/method/suite.mail.api.",
    # mail — backward-compatible prefix for the standalone `mail` app's
    # endpoints still called by Frappe Framework (see override_whitelisted_methods).
    "/api/method/mail.api.",
    "/api/method/suite.calendar.api.",
    "/api/method/suite.meet.api.",
    "/api/method/suite.drive.api.",
    # drive — the §11.2 route namespace. Additive: the legacy method prefix
    # above stays until Cleanup removes it, one release after Build (§11.7).
    "/api/suite/drive/",
    "/api/method/suite.writer.api.",
    # writer — backward-compatible prefix for embed URLs stored in old documents
    # (see override_whitelisted_methods).
    "/api/method/writer.api.",
    "/api/method/suite.slides.api.",
    "/api/method/suite.sheets.api.",
    # drive — WebDAV namespace
    "/dav/",
]

DENIED_PATHS = []

DENIED_WILDCARD_PATHS = [
    "/api/",
]
