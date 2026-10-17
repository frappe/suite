"""The blob layout Build copies legacy S3 objects into.

Pure functions, so the layout (§14.2 step 3) is one readable expression
instead of a boto3 call to inspect. They mirror the framework: `blob_key` is
`frappe.storage.blob.make_key`, and `private_key` is `S3Driver.object_key`
for a private blob. `tests/test_layout.py` pins both against the framework.

`blob_name` is the one thing the framework does not decide. `put_blob` names
a blob at random; Build derives the name from the checksum, so a resumed run
finds the object an interrupted run already copied (see `s3_copy`).
"""

import hashlib

from frappe.storage.blob import key_filename

# S3 `CopyObject` refuses a source above this size, so anything larger goes
# through the boto3 managed multipart copy (§14.2 step 3, "5 GB").
MULTIPART_COPY_THRESHOLD = 5 * 1024**3

# `S3Driver.object_key` puts every private blob key under this.
PRIVATE_NAMESPACE = "private/"

# Changing this renames every blob a resumed run looks for.
BLOB_NAME_NAMESPACE = b"suite-drive-build:"


def blob_name(checksum: str) -> str:
    """`File Blob.name` Build gives new content: ten hex characters.

    Hex fits the `[0-9a-z]{10}` shape of framework blob names."""
    return hashlib.sha256(BLOB_NAME_NAMESPACE + checksum.encode()).hexdigest()[:10]


def blob_folder(key_prefix: str, name: str) -> str:
    """Every key `make_key` gives this blob starts with this folder."""
    return f"{key_prefix}{name}/"


def blob_key(key_prefix: str, name: str, filename: str | None) -> str:
    """`File Blob.key`: `<site prefix>/<blob>/<filename>`, as `make_key` builds it."""
    return blob_folder(key_prefix, name) + key_filename(filename)


def private_key(key: str) -> str:
    """The bucket key a private blob's `key` occupies: `S3Driver.object_key`."""
    return PRIVATE_NAMESPACE + key


def needs_multipart_copy(size: int) -> bool:
    """Whether an object of this size must use the managed multipart copy."""
    return size > MULTIPART_COPY_THRESHOLD
