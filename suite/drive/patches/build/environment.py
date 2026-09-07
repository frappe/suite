"""What Build is allowed to reach, in one value.

`BuildEnvironment.for_site()` wires the real ports; a test builds the same
object out of `tests.fakes`. Nothing below this line knows whether it is
talking to a bucket or to a dictionary.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

from suite.drive.patches.build.ports import LegacyFiles, S3Bucket, StorageGateway
from suite.drive.patches.build.state import BuildState

# §14.2: Build commits per batch of 1000 rows.
BUILD_BATCH_SIZE = 1000

# The framework backfill pages at 500 by default and commits per page.
BACKFILL_BATCH_SIZE = 500


@dataclass(frozen=True)
class LegacyS3Config:
    """`Drive Disk Settings`, reduced to what Build needs."""

    enabled: bool = False
    bucket: str = ""

    @classmethod
    def for_site(cls) -> LegacyS3Config:
        import frappe

        settings = frappe.get_single("Drive Disk Settings")
        return cls(enabled=bool(settings.enabled), bucket=settings.bucket or "")


@dataclass
class BuildEnvironment:
    storage: StorageGateway
    files: LegacyFiles
    state: BuildState
    legacy_s3: LegacyS3Config = field(default_factory=LegacyS3Config)
    open_bucket: Callable[[], S3Bucket] | None = None

    @classmethod
    def for_site(cls) -> BuildEnvironment:
        from suite.drive.patches.build.ports import BotoBucket, SiteFiles, SiteStorage
        from suite.drive.utils.files import S3_URL_PREFIX

        return cls(
            storage=SiteStorage(),
            files=SiteFiles(S3_URL_PREFIX),
            state=BuildState.for_site(),
            legacy_s3=LegacyS3Config.for_site(),
            # Deferred: building the driver constructs a boto3 client, and the
            # gate must be able to refuse a misconfigured site first.
            open_bucket=BotoBucket.from_site,
        )

    def bucket(self) -> S3Bucket:
        if self.open_bucket is None:
            raise RuntimeError("Build has no S3 bucket, but the legacy S3 copy step needs one")
        return self.open_bucket()
