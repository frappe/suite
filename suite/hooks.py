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
		"name": "drive",
		"logo": "/assets/suite/drive/images/icons/logo.svg",
		"title": "Drive",
		"route": "/drive",
	},
	{
		"name": "slides",
		"logo": "/assets/suite/slides/images/slides.svg",
		"title": "Slides",
		"route": "/slides",
	},
	{
		"name": "writer",
		"logo": "/assets/suite/writer/images/writer.png",
		"title": "Writer",
		"route": "/writer",
	},
	{
		"name": "sheets",
		"logo": "/assets/suite/sheets/logo.svg",
		"title": "Sheets",
		"route": "/sheets",
	},
	{
		"name": "meet",
		"logo": "/assets/suite/meet/images/meet.png",
		"title": "Meet",
		"route": "/meet",
	},
	{
		"name": "mail",
		"logo": "/assets/suite/mail/images/logo.svg",
		"title": "Mail",
		"route": "/mail",
	},
	{
		"name": "calendar",
		"logo": "/assets/suite/calendar/images/logo.svg",
		"title": "Calendar",
		"route": "/calendar",
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

# mail — website redirects
website_redirects = [
	{"source": "/", "target": "/suite"},
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

# ============================================================================
# Permissions — permission_query_conditions (deep-merged union; no key clashes)
# ============================================================================
permission_query_conditions = {
	# drive
	"Drive Team": "suite.drive.utils.overrides.filter_drive_team",
	"Drive Permission": "suite.drive.utils.overrides.filter_drive_permission",
	"Drive Favourite": "suite.drive.utils.overrides.filter_drive_favourite",
	"Drive Entity Log": "suite.drive.utils.overrides.filter_drive_recent",
	"Drive Notification": "suite.drive.utils.overrides.filter_drive_notif",
	# slides
	"Presentation": "suite.slides.doctype.presentation.presentation.get_permission_query_conditions",
	# writer
	"Writer Template": "suite.writer.overrides.filter_templates",
	# sheets
	"Sheet Op Log": "suite.sheets.permissions.sheet_op_log_query",
	"Sheet Snapshot": "suite.sheets.permissions.sheet_snapshot_query",
	# mail (client)
	"Account Settings": "suite.client.doctype.account_settings.account_settings.get_permission_query_condition",
	"Blocked Email Address": "suite.client.doctype.blocked_email_address.blocked_email_address.get_permission_query_condition",
	"Calendar Exchange": "suite.client.doctype.calendar_exchange.calendar_exchange.get_permission_query_condition",
	"Junk Email Address": "suite.client.doctype.junk_email_address.junk_email_address.get_permission_query_condition",
	"Mail Exchange": "suite.client.doctype.mail_exchange.mail_exchange.get_permission_query_condition",
	"Mail Queue": "suite.client.doctype.mail_queue.mail_queue.get_permission_query_condition",
	"Mail Sync History": "suite.client.doctype.mail_sync_history.mail_sync_history.get_permission_query_condition",
	"Mailbox Settings": "suite.client.doctype.mailbox_settings.mailbox_settings.get_permission_query_condition",
	"User Settings": "suite.client.doctype.user_settings.user_settings.get_permission_query_condition",
}

# ============================================================================
# Permissions — has_permission (deep-merged union; no key clashes)
# ============================================================================
has_permission = {
	# drive
	"File": "suite.drive.api.permissions.user_has_permission",
	# slides
	"Presentation": "suite.slides.doctype.presentation.presentation.has_permission",
	# writer
	"Writer Document": "suite.writer.perms.has_permission",
	# sheets
	"Sheet Op Log": "suite.sheets.permissions.sheet_op_log_has_permission",
	"Sheet Snapshot": "suite.sheets.permissions.sheet_snapshot_has_permission",
	# mail (client)
	"Account Settings": "suite.client.doctype.account_settings.account_settings.has_permission",
	"Address Book": "suite.client.doctype.address_book.address_book.has_permission",
	"Blocked Email Address": "suite.client.doctype.blocked_email_address.blocked_email_address.has_permission",
	"Calendar": "suite.client.doctype.calendar.calendar.has_permission",
	"Calendar Event": "suite.client.doctype.calendar_event.calendar_event.has_permission",
	"Calendar Exchange": "suite.client.doctype.calendar_exchange.calendar_exchange.has_permission",
	"Contact Card": "suite.client.doctype.contact_card.contact_card.has_permission",
	"Event Notification": "suite.client.doctype.event_notification.event_notification.has_permission",
	"Identity": "suite.client.doctype.identity.identity.has_permission",
	"Junk Email Address": "suite.client.doctype.junk_email_address.junk_email_address.has_permission",
	"Mail Exchange": "suite.client.doctype.mail_exchange.mail_exchange.has_permission",
	"Mail Queue": "suite.client.doctype.mail_queue.mail_queue.has_permission",
	"Mail Sync History": "suite.client.doctype.mail_sync_history.mail_sync_history.has_permission",
	"Mailbox": "suite.client.doctype.mailbox.mailbox.has_permission",
	"Mailbox Settings": "suite.client.doctype.mailbox_settings.mailbox_settings.has_permission",
	"Participant Identity": "suite.client.doctype.participant_identity.participant_identity.has_permission",
	"Push Subscription": "suite.client.doctype.push_subscription.push_subscription.has_permission",
	"Quota": "suite.client.doctype.quota.quota.has_permission",
	"Sieve Script": "suite.client.doctype.sieve_script.sieve_script.has_permission",
	"User Account": "suite.client.doctype.user_account.user_account.has_permission",
	"User Settings": "suite.client.doctype.user_settings.user_settings.has_permission",
	"Vacation Response": "suite.client.doctype.vacation_response.vacation_response.has_permission",
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
	# mail — backward-compatible redirects for the standalone `mail` app's
	# endpoints (still called by Frappe Framework's frappe/email/frappemail.py)
	# now that the API lives under the combined `suite` app.
	"mail.api.auth.validate": "suite.mail.api.auth.validate",
	"mail.api.outbound.upload_attachment": "suite.mail.api.outbound.upload_attachment",
	"mail.api.outbound.send": "suite.mail.api.outbound.send",
	"mail.api.outbound.send_raw": "suite.mail.api.outbound.send_raw",
	"mail.api.inbound.fetch_blob": "suite.mail.api.inbound.fetch_blob",
	"mail.api.inbound.pull": "suite.mail.api.inbound.pull",
	"mail.api.inbound.pull_raw": "suite.mail.api.inbound.pull_raw",
}

# ============================================================================
# Document Events (deep-merged; per-doctype/per-event handler lists combined)
# ============================================================================
doc_events = {
	"Presentation": {
		"on_update": ["suite.drive.api.integration.presentation"],
		"on_trash": ["suite.drive.api.integration.presentation"],
	},
	"User": {
		"after_insert": [
			"suite.drive.utils.users.assign_drive_role_and_create_settings",
			"suite.meet.utils.user.assign_meet_role",
			"suite.mail.events.create_user_settings",
		],
		"on_update": [
			"suite.mail.events.update_account_password",
		],
		"on_trash": [
			"suite.mail.events.delete_account",
			"suite.mail.events.delete_user_settings",
		],
	},
}

# ============================================================================
# Scheduled Tasks (per-frequency lists combined; cron keys de-duplicated)
# ============================================================================
scheduler_events = {
	"daily": [
		# drive
		"suite.drive.api.scripts.auto_delete_from_trash",
		"suite.drive.api.scripts.clear_deleted_files",
		# sheets
		"suite.sheets.versioning.tasks.rollup_snapshots",
		"suite.sheets.versioning.tasks.truncate_op_log",
		# mail
		"suite.client.doctype.mail_exchange.mail_exchange.clean_import_export_directories",
		"suite.client.doctype.calendar_exchange.calendar_exchange.clean_calendar_import_export_directories",
	],
	"hourly": [
		# mail
		"suite.client.doctype.mail_exchange.mail_exchange.retry_stuck_mail_exchanges",
	],
	"hourly_long": [
		# mail
		"suite.client.doctype.mail_message.mail_message.schedule_fetch_changes",
	],
	"cron": {
		"*/5 * * * *": [
			# mail (server)
			"suite.server.doctype.server_job.server_job.retry_failed_jobs",
			"suite.server.doctype.server_deployment.server_deployment.retry_failed_deployments",
			"suite.server.doctype.server_ansible_play.server_ansible_play.retry_failed_ansible_plays",
			# mail (client)
			"suite.client.doctype.mail_queue.mail_queue.enqueue_process_pending_emails",
		],
	},
}

# ============================================================================
# Lifecycle hooks — dispatched through suite.suite_core.boot so that EACH
# former app's handler is preserved and invoked in order.
# ============================================================================
from suite.suite_core import boot as _suite_boot

after_install = "suite.suite_core.boot.after_install"
after_migrate = "suite.suite_core.boot.after_migrate"
after_app_install = "suite.suite_core.boot.after_app_install"
extend_bootinfo = "suite.suite_core.boot.extend_bootinfo"

# drive — custom upload + after_request middleware (single definers)
after_file_upload = "suite.drive.overrides.file.after_file_upload"
after_request = "suite.drive.api.product.after_request"

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
]

# ============================================================================
# Misc carried-over hooks
# ============================================================================
# drive — custom signup template
signup_form_template = "templates/signup.html"

# mail — link integrity on delete
ignore_links_on_delete = [
	# Server
	"Mail Account Request",
	"Mail Domain Request",
	"Server Job",
	"Server Ansible Play",
	"Server Deployment",
	# Client
	"Account Settings",
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
	"/api/method/suite.writer.api.",
	"/api/method/suite.slides.api.",
	"/api/method/suite.sheets.api.",
]

DENIED_PATHS = []

DENIED_WILDCARD_PATHS = [
	"/api/",
]
