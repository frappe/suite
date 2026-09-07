"""The refusals Build makes before it writes anything (§14.1).

Two checks from the spec's table, plus the S3 identity §14.2 step 3 takes
for granted when it says the copy stays "in the same bucket": a server-side
copy needs both keys reachable from one client. Without that check a
mismatched site does not fail, it succeeds with every Drive file recorded
as missing bytes.

Every check reads only. They raise instead of calling `frappe.throw`: a
migration failure needs the message intact in the traceback, and
`frappe.throw` rewrites it depending on whether stdin is a terminal.
"""

import frappe


class BuildGateError(frappe.ValidationError):
    """Build refused to start. Nothing was mutated."""


def check_gate(env) -> None:
    """Raise `BuildGateError` unless the site can complete a whole Build."""
    if not env.storage.enabled():
        raise BuildGateError(
            "Drive Build needs File Storage v2. Set `storage_v2` in site_config "
            "and migrate again; a site must not half-migrate."
        )

    if not env.legacy_s3.enabled:
        return

    driver = env.storage.driver_name()
    if driver != "s3":
        raise BuildGateError(
            "Drive Disk Settings has S3 enabled, so Build must copy its objects "
            "into the framework layout, but site_config `storage_driver` is "
            f"{driver or 'unset'!r}. Set it to 's3' and migrate again."
        )

    config = env.storage.driver_config() or {}
    bucket = config.get("bucket")
    if not bucket:
        raise BuildGateError(
            "Drive Disk Settings has S3 enabled, but site_config "
            "`storage_driver_config` names no bucket. The S3 copy step needs a "
            "configured driver."
        )

    if not env.legacy_s3.bucket:
        raise BuildGateError(
            "Drive Disk Settings has S3 enabled but names no bucket, so Build "
            "cannot tell whether its objects are the ones site_config points at. "
            "Fill in Drive Disk Settings.bucket."
        )

    if bucket != env.legacy_s3.bucket:
        raise BuildGateError(
            "The S3 copy is server-side and stays in one bucket, but "
            f"Drive Disk Settings uses {env.legacy_s3.bucket!r} and site_config "
            f"`storage_driver_config` uses {bucket!r}. Point both at one bucket."
        )

    legacy_endpoint = _endpoint(env.legacy_s3.endpoint_url)
    driver_endpoint = _endpoint(config.get("endpoint_url"))
    if legacy_endpoint != driver_endpoint:
        raise BuildGateError(
            f"Both settings name the bucket {bucket!r}, but Drive Disk Settings "
            f"reaches it at {legacy_endpoint or 'the AWS default endpoint'} and "
            f"site_config at {driver_endpoint or 'the AWS default endpoint'}. "
            "Those are two different buckets, and Build would copy nothing."
        )


def _endpoint(value) -> str:
    """One spelling for an endpoint, so a trailing slash is not a mismatch."""
    return (value or "").rstrip("/")
