import json

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def ensure_custom_fields():
	"""Create Drive's `File` custom fields (team, status, content_doctype, ...).

	They ship as fixtures, which Frappe syncs only AFTER after_install runs. But
	inside the suite app Drive overrides the core File class app-wide, so a File
	created during ANY module's after_install (e.g. Mail's default folders) runs
	through Drive's hooks and needs these columns to already exist. Create them up
	front. Idempotent: create_custom_fields updates fields in place on re-run.
	"""
	path = frappe.get_app_path("suite", "fixtures", "custom_field.json")
	with open(path) as f:
		fields = json.load(f)

	grouped = {}
	for df in fields:
		grouped.setdefault(df["dt"], []).append(df)

	create_custom_fields(grouped, ignore_validate=True)


def after_install():
	index_check = frappe.db.sql(
		"""SHOW INDEX FROM `tabFile` WHERE Key_name = 'drive_file_name_fts_idx'"""
	)
	if not index_check:
		frappe.db.sql(
			"""ALTER TABLE `tabFile` ADD FULLTEXT INDEX drive_file_name_fts_idx (file_name)"""
		)
