"""The canonical blob layout Build copies legacy S3 objects into.

Two pure functions, so the layout the spec fixes (§14.2 step 3) is one
readable expression instead of a boto3 call to inspect. Both mirror the
framework: `blob_key` is `frappe.storage.blob.make_key` plus the extension
`put_blob` appends, and `object_key` is `S3Driver.object_key`.
`tests/test_layout.py` pins both against the framework functions.
"""

from frappe.storage.blob import make_key, sanitized_extension

# S3 `CopyObject` refuses a source above this size, so anything larger goes
# through the boto3 managed multipart copy (§14.2 step 3, "5 GB").
MULTIPART_COPY_THRESHOLD = 5 * 1024**3


def blob_key(checksum: str, filename: str | None = None) -> str:
    """`File Blob.key` for content: `<ab>/<cd>/<sha256>[.ext]`."""
    key = make_key(checksum)
    if ext := sanitized_extension(filename):
        key = f"{key}.{ext}"
    return key


def private_key(key: str) -> str:
    """The bucket key a private blob's `key` occupies: `S3Driver.object_key`."""
    return f"private/{key}"


def object_key(checksum: str, filename: str | None = None) -> str:
    """The bucket key a private blob occupies: `private/<ab>/<cd>/<sha256>[.ext]`."""
    return private_key(blob_key(checksum, filename))


def needs_multipart_copy(size: int) -> bool:
    """Whether an object of this size must use the managed multipart copy."""
    return size > MULTIPART_COPY_THRESHOLD
