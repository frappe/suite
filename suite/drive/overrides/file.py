import shutil
from pathlib import Path

import frappe
import mimemapper
from frappe.core.doctype.file.file import File as FrappeFile
from frappe.core.doctype.file.utils import get_content_hash
from frappe.utils import get_files_path, now

from suite.drive.api.activity import create_new_activity_log
from suite.drive.api.files import get_file_type
from suite.drive.api.permissions import (
	get_entity_with_permissions,
	get_user_access,
	user_has_permission,
)
from suite.drive.api.product import invite_users
from suite.drive.utils import (
	ATTACHMENT_CONTENT_DOCTYPE,
	STATUS_ACTIVE,
	STATUS_REMOVED,
	generate_upward_path,
	get_default_team,
	get_home_folder,
	get_new_file_name,
	get_upload_path,
	is_site_file,
	update_file_size,
	validate_filename,
)
from suite.drive.utils.files import FileManager


class File(FrappeFile):
	"""Team files use Drive's storage/identity rules; Site files (no team) fall
	through to framework `File` behavior."""

	def validate(self):
		if is_site_file(self):
			return super().validate()
		# Blob-backed Drive files must be private: they're served only through
		# Drive's permission layer, never the public /files/ path. Folders, links
		# and content-doctype files have no on-disk blob, so they're exempt.
		if not self.is_folder and not self._not_in_disk() and not self.is_private:
			frappe.throw("Drive files must be private.", frappe.ValidationError)
		# file_name is coupled to the blob path; only rename()/move() may change it.
		if not self.is_new() and self.has_value_changed("file_name") and not self.flags.drive_disk_rename:
			frappe.throw(
				"Rename Drive files from the Drive interface, not the File form.",
				frappe.ValidationError,
			)

	def before_insert(self):
		# Team files: Drive's upload flow owns storage, so skip core's before_insert.
		if is_site_file(self):
			return super().before_insert()

	def get_full_path(self):
		if is_site_file(self):
			return super().get_full_path()
		return get_files_path(self.file_url, private=True)

	def autoname(self):
		if is_site_file(self):
			return super().autoname()
		self.name = getattr(self, "_name", None) or frappe.generate_hash(length=10)

	def after_insert(self):
		if is_site_file(self) or frappe.flags.get("mute_drive_activity_log"):
			return
		full_name = frappe.db.get_value("User", frappe.session.user, "full_name")
		create_new_activity_log(
			entity=self.name,
			activity_type="create",
			activity_message=f"{full_name} created {self.file_name}",
			document_field="file_name",
			field_new_value=self.file_name,
		)

	def after_delete(self):
		if is_site_file(self):
			return

		if self.is_folder:
			for child_name in frappe.get_all("File", filters={"folder": self.name}, pluck="name"):
				frappe.delete_doc("File", child_name, ignore_permissions=True)

		frappe.db.delete("Drive Favourite", {"entity": self.name})
		frappe.db.delete("Drive Entity Log", {"entity_name": self.name})
		frappe.db.delete("Drive Permission", {"entity": self.name})
		frappe.db.delete("Drive Notification", {"notif_doctype_name": self.name})
		frappe.db.delete("Drive Entity Activity Log", {"entity": self.name})

		if (
			self.content_doctype
			and self.content_docname
			and self.content_doctype != ATTACHMENT_CONTENT_DOCTYPE
			and frappe.db.exists(self.content_doctype, self.content_docname)
		):
			frappe.delete_doc(self.content_doctype, self.content_docname, ignore_permissions=True)

	def on_rollback(self):
		if is_site_file(self) or not self.flags.file_created or not self.file_url:
			return
		path = Path(get_files_path(self.file_url, private=True))
		if not path.exists():
			return
		if self.is_folder:
			shutil.rmtree(path)
		else:
			path.unlink()

	def _not_in_disk(self):
		return self.file_type == "Link" or not self.file_url or bool(self.content_doctype)

	# Drive methods
	def _update_modified(func):
		"""Used for functions that meaningfuly "modify" a file"""

		def decorator(self, *args, **kwargs):
			# Legacy code
			res = func(self, *args, **kwargs)
			self.db_set("file_modified", now())
			return res

		return decorator

	@frappe.whitelist()
	def share(
		self,
		user: str | None = None,
		read: bool | None = None,
		comment: bool | None = None,
		share: bool | None = None,
		upload: bool | None = None,
		write: bool | None = None,
		team: bool = False,
	):
		if not user_has_permission(self, "share"):
			frappe.throw("Not permitted to share", frappe.PermissionError)

		# You can only hand out access you hold yourself, so a user with (say)
		# read+share can't grant write/upload they don't have. Admins hold
		# everything implicitly — get_user_access doesn't know that.
		if frappe.session.user != "Administrator" and "Drive Admin" not in frappe.get_roles():
			granter = get_user_access(self, frappe.session.user)
			requested = {"read": read, "comment": comment, "share": share, "upload": upload, "write": write}
			for level, value in requested.items():
				if value and not granter.get(level):
					frappe.throw(
						f"You cannot grant '{level}' access that you don't have yourself.",
						frappe.PermissionError,
					)

		# Clean out existing general records
		if not user or team:
			self.unshare("$GENERAL")

		permission = frappe.db.get_value(
			"Drive Permission",
			{
				"entity": self.name,
				"user": user or "",
				"team": team,
			},
		)
		if not permission:
			permission = frappe.new_doc("Drive Permission")
			permission.update(
				{
					"user": user,
					"team": team,
					"entity": self.name,
				}
			)
		else:
			permission = frappe.get_doc("Drive Permission", permission)

		# Create user
		if user and not frappe.db.exists("User", user):
			invite_users(user, auto=True)

		levels = [
			["read", read],
			["comment", comment],
			["share", share],
			["upload", upload],
			["write", write],
		]
		permission.update({l[0]: l[1] for l in levels if l[1] is not None})

		permission.save(ignore_permissions=True)

	@frappe.whitelist()
	def unshare(self, user: str | None = None):
		if not user_has_permission(self, "share"):
			frappe.throw("Not permitted to unshare", frappe.PermissionError)

		absolute_path = generate_upward_path(self.name)
		for i in absolute_path:
			if i["owner"] == user:
				frappe.throw("User owns parent folder", frappe.PermissionError)

		if user == "$GENERAL":
			perm_names = frappe.db.get_list(
				"Drive Permission",
				{"entity": self.name},
				or_filters={"user": "", "team": 1},
				pluck="name",
			)
			for perm_name in perm_names:
				frappe.delete_doc("Drive Permission", perm_name, ignore_permissions=True)

			# If overriding perms of a parent folder, write out an explicit denial
			public_access = get_user_access(self, "Guest")
			team_access = get_user_access(self, team=1)
			user = None
			if public_access["read"]:
				user = ""
			elif team_access["read"]:
				user = team_access["team"]

			# Doesn't work as higher access "overrides" in get_user_access
			if user is not None:
				frappe.get_doc(
					{
						"doctype": "Drive Permission",
						"user": user,
						"entity": self.name,
						"read": 0,
						"comment": 0,
						"share": 0,
						"write": 0,
						"team": bool(user),
					}
				).insert()

		else:
			perm_name = frappe.db.get_value(
				"Drive Permission",
				{
					"user": user,
					"entity": self.name,
				},
			)
			if perm_name:
				frappe.delete_doc("Drive Permission", perm_name, ignore_permissions=True)

	@_update_modified
	def move(self, new_parent=None, new_team=None):
		"""
		Move file to a new folder.
		"""
		# Logic to decide new values
		if new_team and not new_parent:
			new_parent = new_parent or get_home_folder(new_team).name
		elif new_parent and not new_team:
			new_team = frappe.db.get_value("File", new_parent, "team")
		elif not new_parent and not new_team:
			new_team = self.team
			new_parent = new_parent or get_home_folder(new_team).name

		if new_parent == self.name:
			frappe.throw(
				"Cannot move into itself",
				ValueError,
			)
		elif not user_has_permission(new_parent, "upload") or not user_has_permission(self, "write"):
			frappe.throw("You don't have permission to move this file.", frappe.PermissionError)

		if not frappe.db.get_value("File", new_parent, "is_folder"):
			frappe.throw(
				"Can only move into folders",
				NotADirectoryError,
			)

		# Sanctioned rename: move() owns the disk move below, so let validate
		# through even though file_name may change on a name collision.
		self.flags.drive_disk_rename = True

		for child in self.get_children():
			if child.name == self.name or child.name == new_parent:
				frappe.throw(
					"Cannot move into itself",
					ValueError,
				)
			elif new_team != child.team:
				child.move(self.name, new_team)

		if new_parent != self.folder:
			old_folder_name = frappe.db.get_value("File", self.folder, "file_name")
			new_folder_name = frappe.db.get_value("File", new_parent, "file_name")
			full_name = frappe.db.get_value("User", frappe.session.user, "full_name")
			create_new_activity_log(
				entity=self.name,
				activity_type="move",
				activity_message=f"{full_name} moved {self.file_name} to {new_folder_name}",
				document_field="folder",
				field_old_value=old_folder_name,
				field_new_value=new_folder_name,
			)

			update_file_size(self.folder, -self.file_size)
			update_file_size(new_parent, +self.file_size)
			self.folder = new_parent
			self.file_name = get_new_file_name(self.file_name, new_parent, self.is_folder, self.name)

		self.team = new_team

		# Update all the children's paths
		if not self.manager.flat and not self._not_in_disk():
			new_path = self.manager.get_disk_path(self)
			self.manager.move(self, str(new_path))
			self.recursive_path_move(self.file_url, new_path)
			self.file_url = new_path
		self.save()

		return frappe.get_value("File", new_parent, ["file_name", "team", "name", "folder"], as_dict=True)

	def toggle_favourite(self):
		existing_doc = frappe.db.exists(
			{
				"doctype": "Drive Favourite",
				"entity": self.name,
				"user": frappe.session.user,
			}
		)
		if existing_doc:
			frappe.delete_doc("Drive Favourite", existing_doc)
			return False
		else:
			frappe.get_doc(
				{
					"doctype": "Drive Favourite",
					"entity": self.name,
					"user": frappe.session.user,
				}
			).insert()
			return True

	@frappe.whitelist()
	@_update_modified
	def rename(self, new_file_name: str):
		"""
		Rename file or folder
		"""
		if not user_has_permission(self, "write"):
			frappe.throw("You cannot rename this file", frappe.PermissionError)

		if new_file_name == self.file_name:
			return self
		validate_filename(new_file_name, self.folder, self.file_type)

		full_name = frappe.db.get_value("User", {"name": frappe.session.user}, ["full_name"])
		message = f"{full_name} renamed {self.file_name} to {new_file_name}"
		create_new_activity_log(
			entity=self.name,
			activity_type="rename",
			activity_message=message,
			document_field="file_name",
			field_old_value=self.file_name,
			field_new_value=new_file_name,
		)
		if len(new_file_name) > 140:
			frappe.throw("Your file_name can't be more than 140 characters.")

		# Sanctioned rename: this method owns the disk move, so let validate through.
		self.flags.drive_disk_rename = True
		self.file_name = new_file_name
		path = self.manager.rename(self)
		if self.file_url and not self._not_in_disk():
			self.recursive_path_move(self.file_url, path)

		self.save()

	def permanent_delete(self):
		write_access = user_has_permission(self, "write")
		parent_write_access = user_has_permission(self.folder, "write")
		if not (write_access or parent_write_access):
			frappe.throw("Not permitted", frappe.PermissionError)

		self.status = STATUS_REMOVED
		if self.is_folder:
			for child in self.get_children():
				child.permanent_delete()
		self.save()

	# Utils
	@property
	def manager(self):
		return FileManager()

	def recursive_path_move(self, old, new):
		if new:
			self.file_url = new
		for child in self.get_children():
			if not child._not_in_disk():
				child.recursive_path_move(
					child.file_url, str(Path(new) / Path(child.file_url).relative_to(old))
				)
		self.save()

	def get_children(self):
		"""Returns a generator that yields child Documents."""
		child_names = frappe.get_list(self.doctype, filters={"folder": self.name}, pluck="name")
		for name in child_names:
			yield frappe.get_doc(self.doctype, name)

	# ------------------------------------------------------------------
	# Content-app SDK
	#
	# Apps that keep their content in their own doctype (Writer, Slides, ...)
	# back each document with a Drive File (`content_doctype`/`content_docname`)
	# and delegate permissions to it. These classmethods, plus the module-level
	# `content_*` helpers below, are their single entry point into Drive.
	# ------------------------------------------------------------------

	@classmethod
	def get_for_doc(cls, doctype: str, docname: str) -> str | None:
		"""Name of the Drive File backing a content document, if any."""
		return frappe.db.get_value("File", {"content_doctype": doctype, "content_docname": docname}, "name")

	@classmethod
	def create_for_doc(
		cls,
		doc,
		parent: str | None = None,
		mime_type: str | None = None,
		file_type: str | None = None,
	):
		"""Create the Drive File backing `doc`, in `parent` or the session
		user's home folder. Returns None when the user has no Drive team."""
		from suite.drive.utils import create_file, get_default_team

		if not parent and not get_default_team():
			return None

		return create_file(
			title=doc.get_title() or "Untitled",
			parent=parent,
			mime_type=mime_type,
			file_type=file_type,
			content_doctype=doc.doctype,
			content_docname=doc.name,
		)

	def is_public(self) -> bool:
		"""Whether anyone with the link can read this file."""
		return bool(user_has_permission(self, "read", "Guest"))


def content_has_permission(doc, ptype="read", user=None):
	"""`has_permission` hook for content doctypes: delegate to the backing
	Drive File; documents without one stay owner-only."""
	user = user or frappe.session.user
	if user == "Administrator" or ptype == "create":
		return True

	file = File.get_for_doc(doc.doctype, doc.name)
	if not file:
		return doc.owner == user
	return bool(user_has_permission(file, ptype, user))


def content_query_conditions(doctype: str, user: str | None, extra: str | None = None) -> str:
	"""`permission_query_conditions` body for content doctypes: owned OR
	directly shared via Drive, OR'd with `extra`. Folder-inherited and public
	grants need Drive's recursive path traversal, impractical in SQL — left to
	`has_permission`."""
	user = user or frappe.session.user
	if user == "Administrator":
		return ""

	table = f"`tab{doctype}`"
	user_lit = frappe.db.escape(user)
	clauses = [
		f"{table}.owner = {user_lit}",
		f"{table}.name IN ("
		f"SELECT `tabFile`.content_docname FROM `tabFile` "
		f"INNER JOIN `tabDrive Permission` ON `tabDrive Permission`.entity = `tabFile`.name "
		f"WHERE `tabFile`.content_doctype = {frappe.db.escape(doctype)} "
		f"AND `tabDrive Permission`.user = {user_lit} "
		f"AND `tabDrive Permission`.`read` = 1)",
	]
	if extra:
		clauses.append(extra)
	return "(" + " OR ".join(clauses) + ")"


def sync_content_file(doc, event):
	"""`doc_events` handler for content doctypes: keep the backing Drive File's
	name in sync on update and trash it when the document is deleted."""
	file = File.get_for_doc(doc.doctype, doc.name)
	if not file:
		return

	drive_file = frappe.get_doc("File", file)
	if event == "on_update":
		drive_file.rename(doc.get_title() or drive_file.file_name)
	elif event == "on_trash":
		drive_file.permanent_delete()


@frappe.whitelist()
def get_file_for_doc(doctype: str, docname: str):
	"""The Drive File (with the caller's access) backing a content document."""
	file = File.get_for_doc(doctype, docname)
	if not file:
		frappe.throw(f"This {doctype} is not backed by a Drive file")
	return get_entity_with_permissions(file)


def after_file_upload(doc):
	# frappe handler.upload_file reassigns `doc` to our return value, so always return it.
	if not is_site_file(doc):
		return doc
	settings = frappe.get_single("Drive Disk Settings")
	if frappe.form_dict.library_file_name:
		library_doc = frappe.get_doc("File", frappe.form_dict.library_file_name)
		doc.team = library_doc.team
		if not is_site_file(doc):
			doc.is_private = 1
			doc.folder = get_home_folder(doc.team)["name"]
			doc.file_type = library_doc.file_type
			doc.file_size = library_doc.file_size
			doc.modified = library_doc.modified
			doc.content_doctype = ATTACHMENT_CONTENT_DOCTYPE
			doc.content_docname = frappe.form_dict.library_file_name
	elif settings.use_drive_for_files and doc.attached_to_name:
		# Needs a personal team to place the file in; without one, leave it a Site attachment.
		personal_team = get_default_team()
		if not personal_team:
			return doc
		doc.team = personal_team
		doc.is_private = 1
		content_hash = get_content_hash(doc.content)
		temp_path = get_upload_path("private/files", content_hash[:6] + "-" + doc.file_name)
		with temp_path.open("wb") as f:
			f.write(doc.content)

		file_path = Path("private/files") / doc.attached_to_doctype / doc.attached_to_name / doc.file_name
		save_folder = Path(frappe.get_site_path()) / file_path.parent
		if not save_folder.exists():
			save_folder.mkdir(parents=True)

		doc.file_url = "/" + str(file_path)
		doc.mime_type = mimemapper.get_mime_type(str(temp_path), native_first=False)
		doc.file_type = get_file_type(doc.mime_type)
		doc.folder = get_home_folder(personal_team)["name"]

		manager = FileManager()
		# Thumbnails on by default so attachments look like drive-native files in the grid.
		manager.upload_file(temp_path, doc)

	return doc
