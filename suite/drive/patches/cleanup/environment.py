"""What Cleanup is allowed to reach, in one value.

`CleanupEnvironment.for_site()` wires the real ports; a test builds the
same object out of `tests.fakes`. Nothing below this line knows whether
it is talking to a database or to a dictionary.

`authorized` and `backup_ref` are not gates: they hold even when every
§14.10 gate passes, because past that point §14.11's only rollback is a
database restore. Nothing in this package sets either of them; a caller
must, and `run_cleanup` refuses until both are set (`gate.require_authorization`).
"""

from __future__ import annotations

from dataclasses import dataclass

from suite.drive.patches.cleanup.ports import (
    BlobColumnDiscovery,
    ClientCallerEvidence,
    ContentRows,
    DiskSettingsSnapshot,
    ForwarderRegistry,
    LegacyFileRows,
    NodeLookup,
    ReachabilityTree,
    S3LegacyPrefix,
    SchemaGateway,
    ThumbnailStore,
    TransactionGateway,
)
from suite.drive.patches.cleanup.state import CleanupState

# Matches Build's own batch size (§14.2), for the same reason: a page this
# size is one round trip a planner tolerates and one unit of resumable work.
CLEANUP_BATCH_SIZE = 1000


@dataclass
class CleanupEnvironment:
    tree: ReachabilityTree
    drive: NodeLookup
    blob_columns: BlobColumnDiscovery
    forwarders: ForwarderRegistry
    callers: ClientCallerEvidence
    files: LegacyFileRows
    schema: SchemaGateway
    content: ContentRows
    thumbnails: ThumbnailStore
    disk_settings: DiskSettingsSnapshot
    s3: S3LegacyPrefix
    transaction: TransactionGateway
    state: CleanupState
    authorized: bool = False
    backup_ref: str | None = None

    @classmethod
    def for_site(cls) -> CleanupEnvironment:
        from suite.drive.patches.cleanup.ports import (
            SiteClientCallerEvidence,
            SiteContentRows,
            SiteDiskSettingsSnapshot,
            SiteForwarderRegistry,
            SiteLegacyFileRows,
            SiteNodeLookup,
            SiteReachabilityTree,
            SiteS3LegacyPrefix,
            SiteSchemaGateway,
            SiteThumbnailStore,
            SiteTransactionGateway,
            site_blob_columns,
        )

        return cls(
            tree=SiteReachabilityTree(),
            drive=SiteNodeLookup(),
            blob_columns=site_blob_columns,
            forwarders=SiteForwarderRegistry(),
            callers=SiteClientCallerEvidence(),
            files=SiteLegacyFileRows(),
            schema=SiteSchemaGateway(),
            content=SiteContentRows(),
            thumbnails=SiteThumbnailStore(),
            disk_settings=SiteDiskSettingsSnapshot(),
            s3=SiteS3LegacyPrefix(),
            transaction=SiteTransactionGateway(),
            state=CleanupState.for_site(),
        )
