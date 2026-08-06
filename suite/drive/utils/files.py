import os
import shutil
import unicodedata
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, unquote

import boto3
import frappe
import mimemapper
from botocore.config import Config
from botocore.exceptions import ClientError
from PIL import Image, ImageOps
from werkzeug.http import dump_options_header

from suite.drive.locks.distributed_lock import DistributedLock

from . import STATUS_ACTIVE, get_root_folder

S3_URL_PREFIX = "/api/method/suite.drive.api.s3.fetch?path="
# Sidecar directories under the Drive root, beside the mirrored tree.
TRASH_PREFIX = ".trash"


class FileManager:
    def __init__(self):
        settings = frappe.get_single("Drive Disk Settings")
        self.settings = settings
        self.s3_enabled = settings.enabled
        # not settings.flat: the Single may predate the field, and the doctype
        # overrides __getattribute__ so a missing row raises instead of defaulting
        self.flat = getattr(settings, "flat", 0)
        self.bucket = settings.bucket
        self.site_folder = Path(frappe.get_site_path())

        if self.s3_enabled:
            self.conn = boto3.client(
                "s3",
                aws_access_key_id=settings.aws_key,
                aws_secret_access_key=settings.get_password("aws_secret"),
                endpoint_url=(settings.endpoint_url or None),
                config=Config(signature_version=settings.signature_version),
            )

    def get_prefix(self):
        return self.settings.root_folder or ""

    def get_root_storage_key(self):
        """Return the backend-normalized storage key for the Drive root folder."""
        file_url = get_root_folder()["file_url"]
        if self.s3_enabled:
            file_url = get_s3_key(file_url)
        return storage_key(file_url)

    def _not_if_flat(func):
        """Flat storage has no directories and no per-file paths, so anything that
        rearranges them is a no-op."""

        def wrapper(self, *args, **kwargs):
            if self.flat:
                return
            return func(self, *args, **kwargs)

        return wrapper

    def can_create_thumbnail(self, file):
        # Only images, videos and PDFs get thumbnails.
        if not getattr(file, "mime_type", None):
            return False
        return file.mime_type.startswith(("image", "video")) or file.mime_type == "application/pdf"

    def upload_file(self, current_path: Path, file, create_thumbnail=True) -> None:
        """
        Moves the file from the current path to another path
        """
        if self.s3_enabled:
            self.conn.upload_file(current_path, self.bucket, get_s3_key(file.file_url))
            if create_thumbnail and self.can_create_thumbnail(file):
                frappe.enqueue(
                    self.upload_thumbnail,
                    now=True,
                    at_front=True,
                    file=file,
                    file_path=str(current_path),
                )
            else:
                os.remove(current_path)
        else:
            os.rename(current_path, self.site_folder / storage_key(file.file_url))
            if file and create_thumbnail and self.can_create_thumbnail(file):
                frappe.enqueue(
                    self.upload_thumbnail,
                    now=True,
                    at_front=True,
                    file=file,
                    file_path=str(self.site_folder / storage_key(file.file_url)),
                )

    def upload_thumbnail(self, file, file_path: str):
        """
        Creates a thumbnail for the file on disk and then uploads to the thumbnail directory
        """
        save_path = self.get_thumbnail_path(file.name).with_suffix(".png")
        disk_path = str(self.site_folder / save_path)

        try:
            with DistributedLock(file_path, exclusive=False):
                if file.mime_type.startswith("image"):
                    with Image.open(file_path).convert("RGB") as image:
                        image = ImageOps.exif_transpose(image)
                        image.thumbnail((512, 512))
                        image.save(disk_path, format="webp")
                elif file.mime_type.startswith("video"):
                    import av

                    with av.open(file_path) as container:
                        stream = container.streams.video[0]
                        if stream.duration:
                            container.seek(stream.duration // 2, stream=stream)
                        image = next(container.decode(stream)).to_image()
                        image.thumbnail((512, 512))
                        image.save(disk_path, format="webp")
                else:
                    import pymupdf

                    with pymupdf.open(file_path) as pdf:
                        page = pdf.load_page(0)
                        zoom = 512 / max(page.rect.width, page.rect.height)
                        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
                        Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(
                            disk_path, format="webp"
                        )

                disk_path = Path(disk_path)
                if self.s3_enabled:
                    # Removes original file
                    os.remove(file_path)
                    self.conn.upload_file(disk_path, self.bucket, str(save_path.with_suffix(".thumbnail")))
                    disk_path.unlink()
                else:
                    final_path = disk_path.with_suffix(".thumbnail")
                    disk_path.rename(final_path)
        except BaseException as e:
            frappe.log_error("Thumbnail failed", e)
            if self.s3_enabled:
                try:
                    os.remove(file_path)
                except FileNotFoundError:
                    pass

    def get_disk_path(self, entity, embed=False):
        """
        Helper function to get path of a file
        """
        if self.flat:
            # One namespace under the root, keyed by id — no tree, no team, so a
            # rename or move never touches storage.
            root = Path(self.get_root_storage_key())
            return root / ("embeds" if embed else "") / entity.name

        # perf: stupidly complicated because we use this both with a real entity and a dict
        parent = (
            Path(storage_key(frappe.get_value("File", entity.folder, "file_url") or ""))
            if not hasattr(entity, "parent_path")
            else Path(entity.parent_path)
        )
        name = escape_component(entity.file_name)
        if embed:
            return parent / ".embeds" / name
        return parent / name

    @_not_if_flat
    def create_folder(self, entity):
        """
        Function to create a folder in the S3 bucket or on disk.
        """
        path = self.get_disk_path(entity)
        if self.s3_enabled:
            self.conn.put_object(Bucket=self.bucket, Key=str(path) + "/", Body="")
        else:
            (self.site_folder / path).mkdir(exist_ok=True)
        return str(path) + "/"

    def get_file(self, entity, range_header=None, log=True):
        """
        Function to get a file, with an optional range header for S3 objects
        """
        file_url = storage_key(entity.file_url)
        try:
            if self.s3_enabled:
                if range_header:
                    buf = self.conn.get_object(Bucket=self.bucket, Key=file_url, Range=range_header)["Body"]
                else:
                    buf = self.conn.get_object(Bucket=self.bucket, Key=file_url)["Body"]
            else:
                with open(self.get_local_path(file_url), "rb") as fh:
                    buf = BytesIO(fh.read())
        except (ClientError, FileNotFoundError, OSError) as e:
            if log:
                frappe.log_error("Drive: could not read file", e)
            frappe.throw("Could not find this file.", frappe.DoesNotExistError)

        return buf

    def get_local_path(self, file_url):
        path = (self.site_folder / storage_key(file_url)).resolve()
        roots = [
            (self.site_folder / "private" / "files").resolve(),
            (self.site_folder / "public" / "files").resolve(),
        ]
        if not any(path.is_relative_to(root) for root in roots):
            frappe.throw("The File URL you've entered is incorrect", frappe.ValidationError)
        return path

    def presigned_url(self, key, download_name, mime_type=None, expires=3600):
        """Short-lived S3 GET URL, range-capable, served straight to the client."""
        bucket = self.bucket
        params = {
            "Bucket": bucket,
            "Key": key,
            "ResponseContentDisposition": content_disposition(download_name),
        }
        if mime_type:
            params["ResponseContentType"] = mime_type
        return self._presign_client(bucket).generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expires
        )

    def _presign_client(self, bucket):
        """generate_presigned_url signs offline, so it never gets the automatic
        region-redirect retry that a real S3 call (get_object, put_object, ...)
        gets for free. Signed against the wrong region, S3 rejects the URL
        outright with PermanentRedirect instead of serving the object. Detect
        the bucket's real region once (get_bucket_location is itself
        region-agnostic) and sign with a client that matches it."""
        if self.settings.endpoint_url:
            # custom/S3-compatible endpoints (e.g. MinIO) don't do AWS's
            # multi-region redirect dance
            return self.conn

        cache_key = f"drive-s3-bucket-region:{bucket}"
        region = frappe.cache().get_value(cache_key)
        if not region:
            try:
                region = self.conn.get_bucket_location(Bucket=bucket).get("LocationConstraint") or "us-east-1"
            except ClientError:
                region = self.conn.meta.region_name or "us-east-1"
            frappe.cache().set_value(cache_key, region, expires_in_sec=24 * 60 * 60)

        if region == self.conn.meta.region_name:
            return self.conn
        return boto3.client(
            "s3",
            aws_access_key_id=self.settings.aws_key,
            aws_secret_access_key=self.settings.get_password("aws_secret"),
            region_name=region,
            config=Config(signature_version=self.settings.signature_version),
        )

    def iter_blocks(self, entity, block_size=4 * 1024 * 1024):
        """Yield a file's bytes lazily so a worker never holds the whole file."""
        if self.s3_enabled:
            source = self.get_file(entity)
            try:
                while chunk := source.read(block_size):
                    yield chunk
            finally:
                source.close()
        else:
            with open(self.get_local_path(entity.file_url), "rb") as fh:
                while chunk := fh.read(block_size):
                    yield chunk

    def write_file(self, path: str | Path, content: str):
        if self.s3_enabled:
            pass
        else:
            with open(self.site_folder / path, "w") as f:
                f.write(content)

    @contextmanager
    def open_file(self, path):
        """
        Context manager that yields a file-like object.
        - On disk: opens in binary mode, closes automatically.
        - On S3: yields the botocore StreamingBody, closes automatically.
        """
        if self.s3_enabled:
            obj = self.conn.get_object(Bucket=self.bucket, Key=path)
            body = obj["Body"]
            try:
                yield body  # StreamingBody is already a file-like object
            finally:
                body.close()
        else:
            f = open(self.get_local_path(path), "rb")
            try:
                yield f
            finally:
                f.close()

    def fetch_new_files(self) -> dict[Path, tuple[str]]:
        """
        Traverse the site folder and return a list of all yet-uncreated files with information
        Returns path, file size, and modified
        Ignores hidden files
        """
        if self.s3_enabled:
            root_folder = Path(self.get_prefix())
            objects = self.conn.list_objects_v2(Bucket=self.bucket).get("Contents", [])
            basic_files = {}

            # Get files...
            for obj in objects:
                obj_path = Path(obj["Key"])

                if (
                    not obj_path.is_relative_to(root_folder)
                    or obj_path == root_folder
                    or any(str(p).startswith(".") for p in obj_path.parts)
                ):
                    continue
                obj_path = obj_path.relative_to(root_folder)
                basic_files[obj_path] = obj

                # Used to "calculate" natural folders, folders created by Drive are already counted
                # Don't count root folder
                parent_path = obj_path.parent
                if obj_path not in basic_files and parent_path != Path("."):
                    basic_files[parent_path] = {
                        "Key": str(parent_path),
                        "Size": 0,
                        "LastModified": obj["LastModified"],
                        "Folder": True,
                    }

            files = {}

            for path, f in basic_files.items():
                # Drive-created folders - registered S3 objects - have trailing slashes.
                is_folder = f.get("Folder") or f["Key"].endswith("/")
                exists = frappe.get_value(
                    "File",
                    {
                        "file_url": f["Key"].rstrip("/") + ("/" if is_folder else ""),
                        "status": STATUS_ACTIVE,
                        "is_folder": int(is_folder),
                    },
                    "name",
                )
                if exists:
                    continue

                mime_type = "folder" if is_folder else mimemapper.get_mime_type(f["Key"], native_first=False)
                # Relative path is key, DB path is f["Key"]
                files[path] = (f["Size"], f["LastModified"].timestamp(), mime_type, f["Key"])
        else:
            root_folder = self.site_folder / "private" / "files" / self.get_prefix()

            # ... and stitch them together with information
            files = {}
            for f in root_folder.glob("**/*"):
                path = f.relative_to(self.site_folder)
                exists = frappe.get_value(
                    "File",
                    {"file_url": str(path), "status": STATUS_ACTIVE},
                    "name",
                )
                if exists or any(p for p in f.parts if p.startswith(".")):
                    continue

                if f.is_dir():
                    mime_type = "folder"
                else:
                    mime_type = mimemapper.get_mime_type(str(f), native_first=False)

                # Twice `path` for compatability with S3 format
                files[path] = (f.stat().st_size, f.stat().st_mtime, mime_type, str(path))

        return files

    def get_thumbnail_path(self, name):
        return Path(self.get_root_storage_key()) / self.settings.thumbnail_prefix / (name + ".thumbnail")

    def get_thumbnail(self, name):
        return self.get_file(frappe._dict({"file_url": str(self.get_thumbnail_path(name))}), log=False)

    def __get_trash_path(self, entity):
        """Keyed by id, not file_name: trash is one flat directory under a single
        root now, and two teams could each trash a `readme.md`."""
        return Path(self.get_root_storage_key()) / TRASH_PREFIX / entity.name

    @_not_if_flat
    def rename(self, entity):
        if not entity.file_url or entity.mime_type == "frappe/slides":
            return
        new_path = self.get_disk_path(entity)
        return self.move(entity, new_path)

    @_not_if_flat
    def move_to_trash(self, entity):
        if not entity.file_url or entity.mime_type in ["frappe/slides", "link"]:
            return

        trash_path = self.__get_trash_path(entity)
        try:
            if self.s3_enabled:
                bucket = self.bucket
                self.conn.copy_object(
                    Bucket=bucket,
                    CopySource={"Bucket": bucket, "Key": storage_key(entity.file_url)},
                    Key=str(trash_path),
                )
                self.conn.delete_object(Bucket=bucket, Key=storage_key(entity.file_url))
            else:
                full_trash_path = self.site_folder / trash_path
                if full_trash_path.exists() and full_trash_path.is_dir():
                    shutil.rmtree(full_trash_path)

                full_trash_path.parent.mkdir(exist_ok=True)
                cur_path = self.get_local_path(entity.file_url)
                if cur_path.is_dir():
                    shutil.move(cur_path, full_trash_path)
                else:
                    cur_path.rename(full_trash_path)
        except (FileNotFoundError, ClientError):
            frappe.log_error(f"Moved {entity.name} to trash without it being on disk")
            pass

    @_not_if_flat
    def restore(self, entity):
        """
        Restore a file from the trash.
        """
        self.move(frappe._dict(file_url=self.__get_trash_path(entity)), entity.file_url)

    @_not_if_flat
    def move(self, entity, new_path: str | Path):
        """
        Move a file on disk
        """
        # Callers pass new_path as either a bare key or a stored file_url;
        # normalize both ends to the actual backend key.
        src_key = storage_key(entity.file_url)
        dest_key = storage_key(new_path)
        try:
            if self.s3_enabled:
                bucket = self.bucket
                self.conn.copy_object(
                    Bucket=bucket,
                    CopySource={"Bucket": bucket, "Key": src_key},
                    Key=dest_key,
                )
                self.conn.delete_object(Bucket=bucket, Key=src_key)
            else:
                cur_path = self.get_local_path(src_key)
                dest_path = self.get_local_path(dest_key)
                if cur_path.is_dir():
                    shutil.move(cur_path, dest_path)
                else:
                    cur_path.rename(dest_path)
        except BaseException:
            frappe.throw("This file doesn't exist on disk.")
        return new_path

    def delete_file(self, entity):
        thumbnail_path = self.get_thumbnail_path(entity.name)

        if self.s3_enabled:
            bucket = self.bucket
            try:
                self.conn.delete_object(Bucket=bucket, Key=storage_key(entity.file_url))
                if thumbnail_path:
                    self.conn.delete_object(Bucket=bucket, Key=str(thumbnail_path))
            except Exception:
                pass
        else:
            try:
                self.get_local_path(entity.file_url).unlink()
                if thumbnail_path:
                    (self.site_folder / thumbnail_path).unlink()
            except FileNotFoundError:
                pass


# Utils
def escape_component(file_name):
    """A name is one path component, but `/` is legal in a name and would forge a
    directory level. Escape it rather than renaming the user's file — `%` first, or
    a name containing a literal `%2F` would decode back into a separator."""
    return (file_name or "").replace("%", "%25").replace("/", "%2F").replace("\\", "%5C")


def unescape_component(component):
    return component.replace("%5C", "\\").replace("%2F", "/").replace("%25", "%")


def storage_key(file_url):
    # file_url -> backend storage key. NOT always relative: upgraded sites stored
    # `?path=/<team>/<id>` and that slash is part of the S3 key. Callers building a
    # local path must lstrip("/") — `Path("a") / "/b" == Path("/b")`.
    file_url = str(file_url)
    if file_url.startswith(S3_URL_PREFIX):
        return unquote(file_url[len(S3_URL_PREFIX) :])
    return file_url.lstrip("/")


def content_disposition(download_name):
    """RFC 6266 attachment header; non-ASCII names ride in RFC 5987 filename*
    (`secure_filename` would strip them to nothing)."""
    try:
        download_name.encode("ascii")
        names = {"filename": download_name}
    except UnicodeEncodeError:
        simple = unicodedata.normalize("NFKD", download_name).encode("ascii", "ignore").decode("ascii")
        quoted = quote(download_name, safe="!#$&+-.^_`|~")
        names = {"filename": simple, "filename*": f"UTF-8''{quoted}"}
    return dump_options_header("attachment", names)


def get_s3_key(file_url):
    prefixes = ["/private/files/", "/files/"]
    for prefix in prefixes:
        if file_url.startswith(prefix):
            return file_url[len(prefix) :]
    return file_url


def get_s3_url(path):
    from urllib.parse import quote

    return S3_URL_PREFIX + quote(path)
