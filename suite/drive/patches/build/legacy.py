"""The legacy Drive URL shapes Build still has to read.

The old backend (`suite/drive/utils/files.py`, removed with the rest of the
legacy code) served S3 objects through one whitelisted method and stored
that method's URL in `File.file_url`. Build reads those rows long after the
method is gone, so the two spellings it needs live here, in the one package
that still cares about them.
"""

from urllib.parse import quote, unquote

# `File.file_url` of a legacy S3 row: the fetch method, then the object key
# URL-encoded as a query parameter.
S3_URL_PREFIX = "/api/method/suite.drive.api.s3.fetch?path="


def get_s3_url(key: str) -> str:
    """The `file_url` the legacy backend wrote for one S3 object key."""
    return S3_URL_PREFIX + quote(key)


def storage_key(file_url: str) -> str:
    """The object key a legacy `file_url` points at.

    An S3 URL decodes its query parameter; any other URL is a local path
    relative to the site directory, so only the leading slash goes.
    """
    if file_url.startswith(S3_URL_PREFIX):
        return unquote(file_url[len(S3_URL_PREFIX) :])
    return file_url.lstrip("/")


# The key layouts the production bucket holds, counted before this shipped.
# Drive never normalised what it wrote: most keys sit in a folder named after
# a hash or a user's email, a fifth start with a slash (the S3 console shows
# a "/" folder), some are bare file names at the root, and only a handful
# live under `Drive Disk Settings.root_folder`. Every bucket call takes the
# key as it is; this classification exists so the dry run, the precondition
# check and the legacy-object delete can report per layout.
LEADING_SLASH = "leading slash"
BARE_ROOT_KEY = "bare key at the bucket root"
UNDER_ROOT_FOLDER = "under root_folder"
ROOT_FOLDER = "a folder at the bucket root"
KEY_SHAPES = (LEADING_SLASH, BARE_ROOT_KEY, UNDER_ROOT_FOLDER, ROOT_FOLDER)


def key_shape(key: str, root_folder: str = "") -> str:
    """Which of `KEY_SHAPES` a legacy object key has."""
    if key.startswith("/"):
        return LEADING_SLASH
    if "/" not in key:
        return BARE_ROOT_KEY
    root = (root_folder or "").strip("/")
    if root and key.startswith(root + "/"):
        return UNDER_ROOT_FOLDER
    return ROOT_FOLDER
