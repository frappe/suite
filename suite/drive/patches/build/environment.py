"""What Build is allowed to reach, in one value.

`BuildEnvironment.for_site()` wires the real ports; a test builds the same
object out of `tests.fakes`. Nothing below this line knows whether it is
talking to a bucket or to a dictionary.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from functools import partial

from suite.drive.patches.build.copy_ledger import CopyLedger
from suite.drive.patches.build.ports import (
    ContentTarget,
    DriveTarget,
    LegacyContent,
    LegacyFiles,
    LegacyRecords,
    LegacySettings,
    LegacyTree,
    RecordsTarget,
    S3Bucket,
    SettingsTarget,
    StorageGateway,
    UsageLedger,
)
from suite.drive.patches.build.state import BuildState
from suite.drive.patches.database_marker import DatabaseMarkers

# §14.2: Build commits per batch of 1000 rows.
BUILD_BATCH_SIZE = 1000

# The framework backfill pages at 500 by default and commits per page.
BACKFILL_BATCH_SIZE = 500

# Site config key an operator sets after reading `private/drive-build-skipped.json`
# to let Build finish with rows it could not convert (§14.9).
ACCEPT_SKIPS_CONFIG_KEY = "drive_build_accept_skips"

# Site config key for how many threads read and copy legacy S3 objects at once.
COPY_WORKERS_CONFIG_KEY = "drive_build_copy_workers"
DEFAULT_COPY_WORKERS = 8
MAX_COPY_WORKERS = 32


def copy_workers(value) -> int:
    """The copy thread count `drive_build_copy_workers` asks for.

    Unset means the default. Anything that is not a whole number from 1 to
    `MAX_COPY_WORKERS` stops the migrate before it starts, rather than
    quietly running with a number the operator did not choose."""
    if value is None or value == "":
        return DEFAULT_COPY_WORKERS
    try:
        workers = int(str(value).strip())
    except ValueError:
        workers = 0
    if isinstance(value, bool) or not 1 <= workers <= MAX_COPY_WORKERS:
        raise ValueError(
            f"site config `{COPY_WORKERS_CONFIG_KEY}` is {value!r}; set a whole number from 1 to "
            f"{MAX_COPY_WORKERS}, or remove it to use {DEFAULT_COPY_WORKERS}."
        )
    return workers


@dataclass(frozen=True)
class LegacyS3Config:
    """`Drive Disk Settings`, reduced to what Build needs."""

    enabled: bool = False
    bucket: str = ""
    endpoint_url: str = ""

    @classmethod
    def for_site(cls) -> LegacyS3Config:
        from frappe.utils import cint

        from suite.drive.patches.build.ports import legacy_single_value

        # Plain `tabSingles` reads: the meta no longer declares these fields
        # by the time Build runs, so `frappe.get_single` would not carry them.
        return cls(
            enabled=bool(cint(legacy_single_value("Drive Disk Settings", "enabled"))),
            bucket=legacy_single_value("Drive Disk Settings", "bucket") or "",
            endpoint_url=legacy_single_value("Drive Disk Settings", "endpoint_url") or "",
        )


@dataclass
class BuildEnvironment:
    storage: StorageGateway
    files: LegacyFiles
    state: BuildState
    legacy_s3: LegacyS3Config = field(default_factory=LegacyS3Config)
    open_bucket: Callable[[], S3Bucket] | None = None
    # Every legacy S3 object the copy step placed, by key, for the manual
    # legacy-object delete. `None` only in a test of a step that never copies.
    copy_ledger: CopyLedger | None = None
    # Ties `state` to this database (`database_marker`). `None` only in a
    # test of one step; `run_build` refuses to start without it.
    markers: DatabaseMarkers | None = None
    # Whether an operator has accepted this run's skipped rows in site config
    # (`drive_build_accept_skips`). Unset, Build refuses to finish with any.
    accept_skips: bool = False
    # Threads the S3 copy reads and copies with (`drive_build_copy_workers`).
    copy_workers: int = DEFAULT_COPY_WORKERS
    # Steps 4 to 6. Left optional so the storage step, and every test of it,
    # keeps building the same environment it always did.
    tree: LegacyTree | None = None
    drive: DriveTarget | None = None
    content: LegacyContent | None = None
    content_target: ContentTarget | None = None
    slide_journal: object | None = None
    # §14.11's rollback evidence for the legacy `DocShare` rows steps 6 and
    # 10 delete once they have rewritten them as grants.
    docshare_journal: object | None = None
    # Steps 9, 11, and 12. Optional for the same reason: a test of one step
    # builds only the ports that step reads.
    records: LegacyRecords | None = None
    records_target: RecordsTarget | None = None
    settings: LegacySettings | None = None
    settings_target: SettingsTarget | None = None
    usage: UsageLedger | None = None
    # Two values every written row needs and no rule should invent: the id a
    # hash-named row gets, and the moment Build wrote it. A test supplies
    # both, so a fixture's output is a fixed string rather than a clock.
    clock: Callable[[], str] | None = None
    make_id: Callable[[], str] | None = None
    make_token: Callable[[], str] | None = None

    @classmethod
    def for_site(cls) -> BuildEnvironment:
        import frappe

        from suite.drive.patches.build.docshare_journal import DocSharePreimageJournal
        from suite.drive.patches.build.gate import refuse_below_upgrade_floor
        from suite.drive.patches.build.legacy import S3_URL_PREFIX
        from suite.drive.patches.build.ports import (
            BotoBucket,
            SiteContentSource,
            SiteContentTarget,
            SiteDrive,
            SiteFiles,
            SiteRecords,
            SiteRecordsTarget,
            SiteSettings,
            SiteSettingsTarget,
            SiteStorage,
            SiteTree,
            SiteUsage,
        )
        from suite.drive.patches.build.slide_journal import SlidePreimageJournal
        from suite.drive.patches.database_marker import SiteDatabaseMarkers

        refuse_below_upgrade_floor()
        workers = copy_workers(frappe.conf.get(COPY_WORKERS_CONFIG_KEY))
        return cls(
            storage=SiteStorage(),
            files=SiteFiles(S3_URL_PREFIX),
            state=BuildState.for_site(),
            legacy_s3=LegacyS3Config.for_site(),
            copy_ledger=CopyLedger.for_site(),
            markers=SiteDatabaseMarkers(),
            accept_skips=bool(frappe.conf.get(ACCEPT_SKIPS_CONFIG_KEY)),
            copy_workers=workers,
            # Deferred: building the driver constructs a boto3 client, and the
            # gate must be able to refuse a misconfigured site first.
            open_bucket=partial(BotoBucket.from_site, connections=workers),
            tree=SiteTree(),
            drive=SiteDrive(),
            content=SiteContentSource(),
            content_target=SiteContentTarget(),
            slide_journal=SlidePreimageJournal.for_site(),
            docshare_journal=DocSharePreimageJournal.for_site(),
            records=SiteRecords(),
            records_target=SiteRecordsTarget(),
            settings=SiteSettings(),
            settings_target=SiteSettingsTarget(),
            usage=SiteUsage(),
        )

    def bucket(self) -> S3Bucket:
        if self.open_bucket is None:
            raise RuntimeError("Build has no S3 bucket, but the legacy S3 copy step needs one")
        return self.open_bucket()

    def database_markers(self) -> DatabaseMarkers:
        if self.markers is None:
            raise RuntimeError(
                "Build has no database markers, so it cannot tell whose record it would resume"
            )
        return self.markers

    def ledger(self) -> CopyLedger:
        if self.copy_ledger is None:
            raise RuntimeError("Build has no copy ledger, but the legacy S3 copy step records every copy")
        return self.copy_ledger

    def now(self) -> str:
        """The stamp Build puts on a row it authored, not one it copied."""
        if self.clock is not None:
            return self.clock()
        from frappe.utils import now

        return now()

    def new_id(self) -> str:
        """A fresh 10-char id, the shape `autoname: hash` produces."""
        if self.make_id is not None:
            return self.make_id()
        import frappe

        return frappe.generate_hash(length=10)

    def new_token(self) -> str:
        """A fresh 22-char base62 link token (§3.3, §14.5).

        `access._mint_link_principal` retries on a `Drive Grant` collision.
        Build does not read back: it runs before the site holds any link
        grant, and 22 base62 characters carry about 128 bits, so the
        collision it would be checking for is not a thing that happens.
        `grants` still refuses to mint twice for one node, which is the
        case a rerun can actually produce.
        """
        if self.make_token is not None:
            return self.make_token()
        import secrets

        from suite.drive._core.access import BASE62

        return "".join(secrets.choice(BASE62) for _ in range(22))
