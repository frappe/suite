# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import base64
from datetime import datetime, timedelta

import frappe
import pycrdt
from frappe.model.document import Document

from suite.drive.api.notifications import create_notification, get_link

COLLISION_ERRORS = (
	frappe.exceptions.QueryDeadlockError,
	frappe.exceptions.TimestampMismatchError,
)

AUTOVERSION_DURATION = 10


class WriterDocument(Document):
	@frappe.whitelist(methods=["POST"])
	def save_doc(self, data: str, html: str | None = None):
		try:
			frappe.db.set_value("Writer Document", self.name, "content", data)
			if html is not None:
				frappe.db.set_value("Writer Document", self.name, "html", html)
			self.update_file(file_size=len(self.content))
		except COLLISION_ERRORS:
			pass

	@frappe.whitelist(methods=["POST"])
	def new_version(self, data: str, title: str | None = None):
		"""Create a new version of the document"""
		if not data or not data.strip() or data.strip() == "<p></p>":
			frappe.response["data"] = False
			return

		manual = bool(title)
		if not manual:
			now_time = frappe.utils.now_datetime()
			last_auto_version = frappe.db.get_value(
				"Writer Version",
				filters={
					"doc": self.name,
					"manual": 0,
				},
				fieldname=["title", "name", "creation"],
				order_by="creation desc",
				as_dict=True,
			)

			if last_auto_version:
				prev_time = datetime.strptime(
					last_auto_version.title,
					"%Y-%m-%d %H:%M",
				)
				diff = now_time - prev_time
				if diff < timedelta(minutes=AUTOVERSION_DURATION):
					frappe.response["data"] = False
					return

			title = datetime.strftime(now_time, "%Y-%m-%d %H:%M")

		# Create a new Writer Version document
		version = frappe.get_doc(
			{
				"doctype": "Writer Version",
				"doc": self.name,
				"snapshot": data,
				"manual": manual,
				"title": title,
			}
		)
		version.insert()

		frappe.response["data"] = version.as_dict()

	@frappe.whitelist(methods=["POST"])
	def update_settings(self, data: str):
		self.settings = data
		self.save()

	@frappe.whitelist(methods=["POST"])
	def save_html(self, html: str):
		self.html = html
		self.update_file()
		self.save()

	def update_file(self, **kwargs):
		file = frappe.db.get_value(
			"File", {"content_docname": self.name, "content_doctype": "Writer Document"}, "name"
		)
		doc = frappe.get_doc("File", file)
		for k in kwargs:
			setattr(doc, k, kwargs[k])
		doc.file_modified = frappe.utils.now()
		doc.save(ignore_permissions=True)

	def save_comments(self, data, file):
		try:
			frappe.db.set_value("Writer Document", self.name, "ycomments", data)

			# Go over every comment in the YJS data and check replies for mentions
			comments_doc = pycrdt.Doc()
			comments_doc.apply_update(base64.b64decode(data))
			comments_map = comments_doc.get("comments", type=pycrdt.Map)
			for comment_id, comment_data in comments_map.items():
				mentions = [{**k, "owner": comment_data["owner"]} for k in comment_data.get("mentions", [])]
				for reply in comment_data["replies"]:
					mentions.extend([{**k, "owner": reply["owner"]} for k in reply.get("mentions", [])])
				if mentions:
					frappe.enqueue(
						notify_comments,
						job_id=f"doc_comments_{self.name}_{comment_id}",
						now=True,
						deduplicate=True,
						mentions=mentions,
						file=file,
					)
		except COLLISION_ERRORS:
			pass

	def rename(self):
		frappe.get_value({"doc": self.name}).rename()

	def as_dict(self, *args, **kwargs):
		result = super().as_dict(*args, **kwargs)
		result.pop("versions")
		return result


def notify_comments(file, mentions):
	for mention in mentions:
		from_owner = frappe.get_cached_value("User", mention["owner"], "full_name")
		new_notification = create_notification(
			mention["owner"],
			mention["id"],
			"Mention",
			file,
			f'{from_owner} mentioned you in a comment in "{file.file_name}".',
		)
		if new_notification:
			try:
				frappe.sendmail(
					recipients=[mention["id"]],
					subject=f"Frappe Drive - Mention in {file.file_name}",
					template="drive_comment",
					args={
						"message": f"{from_owner} mentioned you in a comment.",
						"doc": file.file_name,
						"link": get_link(file),
					},
					now=True,
				)
			except Exception:
				frappe.log_error(frappe.get_traceback())
