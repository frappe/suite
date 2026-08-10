import shutil
from pathlib import Path

import frappe
import mimemapper
from frappe.core.doctype.file.file import File as FrappeFile
from frappe.utils import get_files_path, now

from suite.drive.api.activity import create_new_activity_log
from suite.drive.api.files import get_file_type
from suite.drive.api.permissions import (
    exceeds_grant_ceiling,
    get_entity_with_permissions,
    get_user_access_for_user,
    user_has_permission,
)
from suite.drive.api.product import create_invites
from suite.drive.utils import (
    ATTACHMENT_CONTENT_DOCTYPE,
    FRAMEWORK_FOLDERS,
    GENERAL_USER,
    GROUP_PREFIX,
    ROOT_FOLDER,
    STATUS_ACTIVE,
    STATUS_REMOVED,
    STATUS_TRASHED,
    WRITER_CONTENT_DOCTYPE,
    generate_upward_path,
    get_new_file_name,
    get_user_folder,
    principal_list,
    update_file_size,
    validate_filename,
)
from suite.drive.utils.files import S3_URL_PREFIX, FileManager, get_s3_url, storage_key


class File(FrappeFile):
    """Every File is Drive-managed. Files created by Drive itself (marked with
    `flags.file_created` before insert) skip the framework's storage flow, which
    Drive owns; framework uploads keep it and are adopted into the tree by
    `after_file_upload`."""

    def validate(self):
        self._validate_content_link()
        if self.is_new() and not self.flags.file_created:
            return super().validate()
        if (
            not self.is_new()
            and not self.flags.file_created
            and self.has_value_changed("file_url")
            and not self._not_in_disk()
        ):
            self.manager.get_local_path(self.file_url)
        # Blob-backed Drive files must be private: they're served only through
        # Drive's permission layer, never the public /files/ path. Folders, links
        # and content-doctype files have no on-disk blob, and adopted framework
        # uploads keep their framework URL and privacy, so they're exempt.
        if (
            not self.is_folder
            and not self._not_in_disk()
            and not self.attached_to_doctype
            and not self.is_private
        ):
            frappe.throw("Drive files must be private.", frappe.ValidationError)
        # file_name is coupled to the blob path; only rename()/move() may change it.
        if not self.is_new() and self.has_value_changed("file_name") and not self.flags.drive_disk_rename:
            frappe.throw(
                "Rename Drive files from the Drive interface, not the File form.",
                frappe.ValidationError,
            )

    def _validate_content_link(self):
        """`content_doctype`/`content_docname` are the sole permission delegation
        point for content documents (see `content_has_permission`): whoever's
        File claims a document effectively owns it, and `after_delete` cascades
        deletion through them. They must only ever be set — or cleared — by
        Drive's own trusted paths (`create_for_doc`, the attachment-reference
        branch of `after_file_upload`, or a migration patch), never by a plain
        user-driven insert or update. Otherwise any user could forge a link to
        someone else's document and inherit full access to it, or (since File
        write access can come from a Drive share, not just ownership) sever an
        existing link to break the permission/deletion delegation and orphan
        the content document."""
        if self.is_new() and not (self.content_doctype or self.content_docname):
            return
        if not self.is_new() and not (
            self.has_value_changed("content_doctype") or self.has_value_changed("content_docname")
        ):
            return
        if self.flags.file_created or self.flags.allow_content_link:
            return
        if frappe.session.user == "Administrator":
            return
        frappe.throw(
            "content_doctype/content_docname can only be set by Drive's own file-creation flow.",
            frappe.PermissionError,
        )

    def before_insert(self):
        # Drive's upload flow owns storage; framework uploads keep core's flow.
        if not self.flags.file_created:
            return super().before_insert()

    def autoname(self):
        if not self.flags.file_created:
            return super().autoname()
        self.name = getattr(self, "_name", None) or frappe.generate_hash(length=10)

    def after_insert(self):
        if not self.flags.file_created or frappe.flags.get("mute_drive_activity_log"):
            return
        full_name = frappe.db.get_value("User", frappe.session.user, "full_name")
        create_new_activity_log(
            entity=self.name,
            activity_type="create",
            activity_message=f"{full_name} created {self.file_name}",
            document_field="file_name",
            field_new_value=self.file_name,
        )

    def on_trash(self):
        # frappe protects Home and Attachments the same way
        if self.name == ROOT_FOLDER:
            frappe.throw("Cannot delete the Drive root folder.", frappe.PermissionError)
        super().on_trash()

    def after_delete(self):
        if self.status == STATUS_REMOVED and not self._not_in_disk():
            self._delete_blob_after_commit(not self.manager.flat)
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
        if not self.flags.file_created or not self.file_url:
            return
        path = Path(get_files_path(self.file_url, private=True))
        if not path.exists():
            return
        if self.is_folder:
            shutil.rmtree(path)
        else:
            path.unlink()

    def _not_in_disk(self):
        content_without_storage = bool(
            self.content_doctype and self.content_doctype != WRITER_CONTENT_DOCTYPE
        )
        return self.file_type == "Link" or not self.file_url or content_without_storage

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
        deny: bool = False,
    ):
        if not user_has_permission(self, "share"):
            frappe.throw("Not permitted to share", frappe.PermissionError)

        # General rows ("" = anyone with the link, $GENERAL = site users) are
        # mutually exclusive — replace wholesale.
        user = user or ""
        if user in ("", GENERAL_USER):
            self._clear_general()
        elif user.startswith(GROUP_PREFIX):
            if not frappe.db.exists("User Group", user[len(GROUP_PREFIX) :]):
                frappe.throw(f"No such group: {user[len(GROUP_PREFIX) :]}", frappe.DoesNotExistError)
        elif not frappe.db.exists("User", user):
            create_invites(user, auto=True)

        permission = frappe.db.get_value("Drive Permission", {"entity": self.name, "user": user})
        if not permission:
            permission = frappe.new_doc("Drive Permission")
            permission.update({"user": user, "entity": self.name})
        else:
            permission = frappe.get_doc("Drive Permission", permission)
        permission.deny = int(deny)

        levels = [
            ["read", read],
            ["comment", comment],
            ["share", share],
            ["upload", upload],
            ["write", write],
        ]
        permission.update({l[0]: l[1] for l in levels if l[1] is not None})

        # Against the resulting row, not just the levels named: clearing `deny` starts
        # granting whatever bits the row still carries.
        if not deny:
            for level in exceeds_grant_ceiling(self, permission.as_dict()):
                frappe.throw(
                    f"You cannot grant '{level}' access that you don't have yourself.",
                    frappe.PermissionError,
                )

        permission.save(ignore_permissions=True)

    @frappe.whitelist()
    def unshare(self, user: str | None = None):
        if not user_has_permission(self, "share"):
            frappe.throw("Not permitted to unshare", frappe.PermissionError)

        absolute_path = generate_upward_path(self.name)
        for i in absolute_path:
            if i["owner"] == user:
                frappe.throw("User owns parent folder", frappe.PermissionError)

        if user in ("", GENERAL_USER):
            self._clear_general()
            # Dropping this file's own general rows is enough unless read is
            # inherited from a folder above (e.g. anything inside Site); then
            # restricting still needs an explicit deny to cut the inheritance.
            if get_user_access_for_user(self, "Guest")["read"]:
                self._insert_deny("")
            if generate_upward_path(self.name, GENERAL_USER)[-1]["read"]:
                self._insert_deny(GENERAL_USER)
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

    def _clear_general(self):
        for name in frappe.get_all(
            "Drive Permission",
            filters={"entity": self.name, "user": ["in", ["", GENERAL_USER]]},
            pluck="name",
        ):
            frappe.delete_doc("Drive Permission", name, ignore_permissions=True)

    def _insert_deny(self, user: str):
        frappe.get_doc(
            {
                "doctype": "Drive Permission",
                "entity": self.name,
                "user": user,
                "deny": 1,
                "read": 1,
                "comment": 1,
                "share": 1,
                "upload": 1,
                "write": 1,
            }
        ).insert(ignore_permissions=True)

    @_update_modified
    def move(self, new_parent=None):
        """
        Move file to a new folder.
        """
        new_parent = new_parent or get_user_folder().name

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
        if any(p["name"] == self.name for p in generate_upward_path(new_parent)):
            frappe.throw(
                "Cannot move into itself",
                ValueError,
            )

        # Sanctioned rename: move() owns the disk move below, so let validate
        # through even though file_name may change on a name collision.
        self.flags.drive_disk_rename = True

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

        # Update all the children's paths. Flat storage keys by id, so nothing on
        # disk or in any file_url depends on where a file sits in the tree.
        if not self._not_in_disk() and not self.manager.flat:
            # folder keys carry a trailing slash, the way create_folder writes them
            new_path = str(self.manager.get_disk_path(self)) + ("/" if self.is_folder else "")
            self.manager.move(self, new_path)
            self.recursive_path_move(self.file_url, new_path)
            self.file_url = new_path
        self.save()

        return frappe.get_value("File", new_parent, ["file_name", "name", "folder"], as_dict=True)

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
        # Flat storage keys by id, so a name has no bearing on any path.
        if not self.manager.flat:
            path = self.manager.rename(self)
            if self.file_url and not self._not_in_disk():
                self.recursive_path_move(self.file_url, path)

        self.save()

    def permanent_delete(self):
        write_access = user_has_permission(self, "write")
        parent_write_access = user_has_permission(self.folder, "write")
        if not (write_access or parent_write_access):
            frappe.throw("Not permitted", frappe.PermissionError)

        delete_blob = not self._not_in_disk()
        blob_is_trashed = self.status == STATUS_TRASHED and not self.manager.flat
        self.status = STATUS_REMOVED
        if self.is_folder:
            for child in self.get_children():
                child.permanent_delete()
        self.save()
        if delete_blob:
            self._delete_blob_after_commit(blob_is_trashed)

    def _delete_blob_after_commit(self, blob_is_trashed: bool):
        entity = frappe._dict(name=self.name, file_url=self.file_url)

        def delete_blob():
            try:
                if blob_is_trashed:
                    self.manager.delete_from_trash(entity)
                else:
                    self.manager.delete_file(entity)
            except Exception:
                frappe.log_error(
                    "Drive: could not permanently delete blob",
                    frappe.get_traceback(),
                )

        frappe.db.after_commit.add(delete_blob)

    # Utils
    @property
    def manager(self):
        return FileManager()

    def recursive_path_move(self, old, new):
        """Repoint this subtree at `new`.

        On disk the parent's own move carried the children with it, so only the
        urls need rewriting. S3 has no directories — moving the folder moved one
        marker object and nothing else — so every descendant's blob has to be
        copied across itself, or the whole subtree becomes unreadable.
        """
        if new:
            self.file_url = new
        manager = self.manager
        for child in self.get_children():
            if child._not_in_disk():
                continue
            child_key = Path(storage_key(child.file_url))
            if not child_key.is_relative_to(storage_key(old)):
                # an adopted framework upload, or anything the relocation left where it
                # was: its blob was never under this folder, so moving us doesn't move it
                continue
            new_child_url = str(Path(storage_key(new)) / child_key.relative_to(storage_key(old)))
            if child.file_url.startswith(S3_URL_PREFIX):
                new_child_url = get_s3_url(new_child_url)
            elif child.file_url.startswith("/"):
                new_child_url = "/" + new_child_url
            # a trashed child's blob is in the trash, not at its file_url — that url is
            # only where a restore would put it back, so repoint it and move nothing
            if manager.s3_enabled and child.status != STATUS_TRASHED:
                manager.move(child, new_child_url)
            child.recursive_path_move(child.file_url, new_child_url)
        self.save()

    def get_children(self):
        """Returns a generator that yields child Documents.

        get_all, not get_list: this is an internal tree walk, authorized at the entry
        point. Permission-filtering it would silently skip children the caller cannot
        see — leaving them orphaned on a move, or Active inside a deleted folder.
        """
        child_names = frappe.get_all(self.doctype, filters={"folder": self.name}, pluck="name")
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
        user's private folder."""
        from suite.drive.utils import create_file

        if not parent:
            parent = get_user_folder().name

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
        f"AND `tabDrive Permission`.user IN ({principal_list(user)}) "
        f"AND `tabDrive Permission`.`read` = 1 AND `tabDrive Permission`.`deny` = 0)",
    ]
    if extra:
        clauses.append(extra)
    return "(" + " OR ".join(clauses) + ")"


def sync_content_file(doc, event):
    """`doc_events` handler for content doctypes: mirror a content document's
    name and trashed-state onto its backing Drive File, and delete the File when
    the document is hard-deleted. Every content app gets this by mutating through
    the ORM (`doc.save()` / `frappe.delete_doc`) — the same front door Writer and
    Slides use — so no app needs its own Drive-sync calls."""
    file = File.get_for_doc(doc.doctype, doc.name)
    if not file:
        return

    drive_file = frappe.get_doc("File", file)
    if event == "on_trash":
        drive_file.permanent_delete()
        return

    # The File is created with an already-deduped name (create_for_doc), so the
    # on_update that fires during that same insert must not touch it again.
    if doc.flags.in_insert:
        return

    before = doc.get_doc_before_save()

    # Mirror soft-trash: content docs carrying a `trashed` flag (e.g. Sheet) drop
    # out of — or return to — the Drive listing in lockstep. Apps without the
    # field (Writer/Slides) hard-delete instead, handled by on_trash above.
    # Only on an actual transition of the flag: Drive's own trash (remove_or_restore)
    # moves the File without touching the content doc, so re-deriving the status
    # from `doc.trashed` on every save would silently undo it.
    if doc.meta.has_field("trashed"):
        if before and bool(before.trashed) != bool(doc.trashed):
            if doc.trashed and drive_file.status == STATUS_ACTIVE:
                drive_file.db_set("status", STATUS_TRASHED, update_modified=False)
            elif not doc.trashed and drive_file.status == STATUS_TRASHED:
                # Restoring: an active sibling may have taken this file's name while
                # it was trashed, so dedupe before it re-enters the active namespace
                # (get_new_file_name counts only active files, so the file being
                # restored is never counted against itself).
                drive_file.db_set(
                    {
                        "file_name": get_new_file_name(
                            drive_file.file_name, drive_file.folder, drive_file.file_type
                        ),
                        "status": STATUS_ACTIVE,
                    },
                    update_modified=False,
                )
        if doc.trashed:
            return

    # Rename to follow the title, but only on an actual title change: a content
    # edit shouldn't rename the File, and re-running the dedup on every save would
    # churn the "(n)" suffix as sibling counts shift.
    if before and before.get_title() == doc.get_title():
        return
    desired_name = doc.get_title() or drive_file.file_name
    if desired_name == drive_file.file_name:
        return
    drive_file.rename(get_new_file_name(desired_name, drive_file.folder, drive_file.file_type))


@frappe.whitelist()
def get_file_for_doc(doctype: str, docname: str):
    """The Drive File (with the caller's access) backing a content document."""
    file = File.get_for_doc(doctype, docname)
    if not file:
        frappe.throw(f"This {doctype} is not backed by a Drive file")
    return get_entity_with_permissions(file)


def after_file_upload(doc):
    # frappe handler.upload_file reassigns `doc` to our return value, so always return it.
    # Guests can't own a user folder; their uploads stay in the framework folders.
    if (doc.folder and doc.folder not in FRAMEWORK_FOLDERS) or frappe.session.user == "Guest":
        return doc

    if frappe.form_dict.library_file_name:
        library_doc = frappe.get_doc("File", frappe.form_dict.library_file_name)
        doc.is_private = 1
        doc.folder = get_user_folder().name
        doc.file_type = library_doc.file_type
        doc.file_size = library_doc.file_size
        doc.modified = library_doc.modified
        doc.content_doctype = ATTACHMENT_CONTENT_DOCTYPE
        doc.content_docname = frappe.form_dict.library_file_name
        # `File` has no has_permission hook keyed on content_doctype, so this
        # self-referential "original" link (unlike Writer/Presentation links)
        # can't grant elevated access to library_doc — safe to allow here.
        doc.flags.allow_content_link = True
    else:
        # Adopt any framework upload — attachment or loose — into the uploader's
        # private folder; the blob stays where the framework wrote it.
        doc.folder = get_user_folder().name
        if not doc.mime_type:
            doc.mime_type = mimemapper.get_mime_type(doc.file_name, native_first=False)
        doc.file_type = get_file_type(doc.mime_type)

    return doc
