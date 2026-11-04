"""What Cleanup is allowed to reach, in one value.

`CleanupEnvironment.for_site()` wires the real ports; a test builds the
same object out of `tests.fakes`. Nothing below this line knows whether
it is talking to a database or to a dictionary.

`backup` is not a gate: it holds even when every §14.10 gate passes,
because past that point §14.11's only rollback is a database restore.
`for_site()` reads it from site config (`BACKUP_CONFIG_KEY`), and
`run_cleanup` refuses until it is set (`gate.require_backup`).
"""

from __future__ import annotations

from dataclasses import dataclass

from suite.drive.patches.cleanup.ports import (
    BlobColumnDiscovery,
    ContentRows,
    DiskSettingsSnapshot,
    LegacyFileRows,
    NodeLookup,
    ReachabilityTree,
    SchemaGateway,
    ThumbnailStore,
    TransactionGateway,
)
from suite.drive.patches.cleanup.state import CleanupState

# Matches Build's own batch size (§14.2), for the same reason: a page this
# size is one round trip a planner tolerates and one unit of resumable work.
CLEANUP_BATCH_SIZE = 1000

# The site_config key naming the backup an operator took before this
# migrate. Its value is free text (a path, an S3 URL, a backup id); Cleanup
# records it in its state file and refuses to run while it is unset.
BACKUP_CONFIG_KEY = "drive_cleanup_backup"


@dataclass
class CleanupEnvironment:
    tree: ReachabilityTree
    drive: NodeLookup
    blob_columns: BlobColumnDiscovery
    files: LegacyFileRows
    schema: SchemaGateway
    content: ContentRows
    thumbnails: ThumbnailStore
    disk_settings: DiskSettingsSnapshot
    transaction: TransactionGateway
    state: CleanupState
    backup: str | None = None

    @classmethod
    def for_site(cls) -> CleanupEnvironment:
        import frappe

        from suite.drive.patches.cleanup.ports import (
            SiteContentRows,
            SiteDiskSettingsSnapshot,
            SiteLegacyFileRows,
            SiteNodeLookup,
            SiteReachabilityTree,
            SiteSchemaGateway,
            SiteThumbnailStore,
            SiteTransactionGateway,
            site_blob_columns,
        )

        backup = str(frappe.conf.get(BACKUP_CONFIG_KEY) or "").strip() or None
        return cls(
            tree=SiteReachabilityTree(),
            drive=SiteNodeLookup(),
            blob_columns=site_blob_columns,
            files=SiteLegacyFileRows(),
            schema=SiteSchemaGateway(),
            content=SiteContentRows(),
            thumbnails=SiteThumbnailStore(),
            disk_settings=SiteDiskSettingsSnapshot(),
            transaction=SiteTransactionGateway(),
            state=CleanupState.for_site(),
            backup=backup,
        )
