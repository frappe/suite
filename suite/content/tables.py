"""Raw InnoDB tables for one product's collaboration log.

They are not DocTypes because Frappe has no binary field type. Every table is
keyed on the control row's id, never on the Drive node.
"""

import frappe

TABLE_OPTIONS = "ENGINE=InnoDB ROW_FORMAT=DYNAMIC CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
KINDS = ("doc", "update", "session", "checkpoint", "stage", "recovery", "projection", "copy", "conversion")


def table(app: str, kind: str) -> str:
    """Name the raw table of `kind` for `app`, refusing a kind or app that isn't one."""
    if kind not in KINDS or not app.isidentifier():
        raise ValueError(f"Unknown content table {app} {kind}")

    return f"__{app}_content_{kind}"


DOC_COLUMNS = (
    # The rev, chain and sha of the checked body in the app's row; 0 while the row holds none
    "`body_rev` bigint unsigned NOT NULL DEFAULT 0",
    "`body_chain` binary(32) NULL",
    "`body_sha` binary(32) NULL",
    "`crdt_version` varchar(40) NULL",
    "`state_bytes` bigint unsigned NOT NULL DEFAULT 0",
    "`tail_rows` bigint unsigned NOT NULL DEFAULT 0",
    "`tail_bytes` bigint unsigned NOT NULL DEFAULT 0",
    # The most the tail can add to the next compaction: the sum of its rows' bounds (capacity.row_bound)
    "`tail_bound` bigint unsigned NOT NULL DEFAULT 0",
    "`compaction_failures` int unsigned NOT NULL DEFAULT 0",
    "`next_compaction_at` datetime(6) NULL",
    "`last_compaction_ms` int unsigned NULL",
    "`last_compaction_error` varchar(140) NULL",
    "`mode` varchar(20) NOT NULL DEFAULT 'active'",
    # Each writer's next clock in the start a copy began with; its writers have no session
    "`start_clocks` json NULL",
    # (first rev, new highest) for each rise in the highest schema a row was stamped with
    "`schema_steps` json NOT NULL DEFAULT '[[0, 1]]'",
    # Rises with every quarantine, so a tab that may have applied a quarantined row rebuilds
    "`q_epoch` int unsigned NOT NULL DEFAULT 0",
    # Why a compaction could not take the rows; compactions skip the document until a job judges it
    "`suspect` varchar(40) NULL",
    # Why judging could not settle it; pushes are refused until an admin reviews it
    "`suspect_held` varchar(40) NULL",
    # The last verdict on a suspect document and how many there have been, which a tab that reported one reads on its pull
    "`verdict` varchar(20) NULL",
    "`judged` int unsigned NOT NULL DEFAULT 0",
    # A judge found a compaction's suspect clean and no checkpoint was installed since; a second mark holds it
    "`suspect_judged_clean` tinyint(1) NOT NULL DEFAULT 0",
    # When a judge last found a fallback clean; fallbacks within a day of it are neither marked nor alerted
    "`fallback_judged_clean_at` datetime(6) NULL",
    # When a tab last reported a row it couldn't apply; one report a minute is heard
    "`suspect_reported_at` datetime(6) NULL",
    # When a push last told the app the document changed, and the head it told; the sweep tells it the rest
    "`touched_at` datetime(6) NULL",
    "`touched_rev` bigint unsigned NOT NULL DEFAULT 0",
    # When a push last took an automatic version, and the head it holds; the sweep takes the rest
    "`versioned_at` datetime(6) NULL",
    "`versioned_rev` bigint unsigned NOT NULL DEFAULT 0",
    # Edit rows through this rev may be gone; the body holds them
    "`trimmed_rev` bigint unsigned NOT NULL DEFAULT 0",
    # A restore's fence while `mode` is 'restoring'; it lapses at its deadline
    "`restore_token` char(32) NULL",
    "`restore_deadline` datetime(6) NULL",
    # The last restore's rev and time; work made before that rev is refused
    "`restore_rev` bigint unsigned NOT NULL DEFAULT 0",
    "`restored_at` datetime(6) NULL",
    # The head chain the last pre-restore version holds
    "`milestone_chain` binary(32) NULL",
)
UPDATE_COLUMNS = (
    # Tables made before per-seq shas were kept
    "`seq_shas` longblob NOT NULL AFTER `sha256`",
    # The schema of the build that wrote each row; every row before stamps came from the first
    "`schema` smallint unsigned NOT NULL DEFAULT 1 AFTER `client_id`",
    # A quarantined row keeps its rev, sha and chain; its payload is emptied and kept as a recovery row
    "`state` varchar(20) NOT NULL DEFAULT 'ok'",
    # What the row can add to a compaction; rows stored before it count their bytes
    "`bound` bigint unsigned NULL AFTER `payload`",
)
SESSION_COLUMNS = (
    # NULL until `backfill_clocks` reads it from sessions made before it was kept
    "`next_clock` bigint unsigned NULL AFTER `acked_seq`",
    # A session that wrote a quarantined row may push no more
    "`closed` tinyint(1) NOT NULL DEFAULT 0",
)
STAGE_COLUMNS = (
    "`rev` bigint unsigned NULL AFTER `seq_to`",
    "`lineage` char(32) NULL AFTER `rev`",
    "`q_epoch` int unsigned NULL AFTER `lineage`",
)


def ensure_doc_table(app: str) -> None:
    """Create the control table and add the columns tables made before them lack."""
    doc_table = table(app, "doc")
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{doc_table}` (
            `id` varchar(20) NOT NULL,
            `node` varchar(140) NOT NULL,
            `lineage` char(32) NOT NULL,
            `head_rev` bigint unsigned NOT NULL DEFAULT 0,
            `head_chain` binary(32) NOT NULL,
            `created` datetime(6) NOT NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `node` (`node`)
        ) {TABLE_OPTIONS}"""
    )
    for column in DOC_COLUMNS:
        frappe.db.sql_ddl(f"ALTER TABLE `{doc_table}` ADD COLUMN IF NOT EXISTS {column}")

    frappe.db.sql_ddl(
        f"ALTER TABLE `{doc_table}` ADD INDEX IF NOT EXISTS `next_compaction_at` (`next_compaction_at`)"
    )
    # A bound is never below its row's bytes, so this only meets tails stored before bounds were kept
    frappe.db.sql(f"UPDATE `{doc_table}` SET `tail_bound` = `tail_bytes` WHERE `tail_bound` < `tail_bytes`")


def ensure_update_table(app: str) -> None:
    """Create the log's rows table and add the columns tables made before them lack."""
    update_table = table(app, "update")
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{update_table}` (
            `doc_id` varchar(20) NOT NULL,
            `rev` bigint unsigned NOT NULL,
            `sid` char(32) NOT NULL,
            `seq_from` bigint unsigned NOT NULL,
            `seq_to` bigint unsigned NOT NULL,
            `client_id` int unsigned NOT NULL,
            `payload` longblob NOT NULL,
            `sha256` binary(32) NOT NULL,
            `seq_shas` longblob NOT NULL,
            `chain` binary(32) NOT NULL,
            `created` datetime(6) NOT NULL,
            PRIMARY KEY (`doc_id`, `rev`),
            UNIQUE KEY `session_seq` (`doc_id`, `sid`, `seq_to`)
        ) {TABLE_OPTIONS}"""
    )
    for column in UPDATE_COLUMNS:
        frappe.db.sql_ddl(f"ALTER TABLE `{update_table}` ADD COLUMN IF NOT EXISTS {column}")


def ensure_session_table(app: str) -> None:
    """Create the sessions table and add the columns tables made before them lack."""
    session_table = table(app, "session")
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{session_table}` (
            `doc_id` varchar(20) NOT NULL,
            `sid` char(32) NOT NULL,
            `client_id` int unsigned NOT NULL,
            `user` varchar(140) NOT NULL,
            `acked_seq` bigint unsigned NOT NULL DEFAULT 0,
            `created` datetime(6) NOT NULL,
            `last_push_at` datetime(6) NULL,
            PRIMARY KEY (`doc_id`, `sid`),
            UNIQUE KEY `client` (`doc_id`, `client_id`)
        ) {TABLE_OPTIONS}"""
    )
    for column in SESSION_COLUMNS:
        frappe.db.sql_ddl(f"ALTER TABLE `{session_table}` ADD COLUMN IF NOT EXISTS {column}")


def ensure_checkpoint_table(app: str) -> None:
    """Create the checkpoints table."""
    checkpoint_table = table(app, "checkpoint")
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{checkpoint_table}` (
            `doc_id` varchar(20) NOT NULL,
            `through_rev` bigint unsigned NOT NULL,
            `chain` binary(32) NOT NULL,
            `sha256` binary(32) NOT NULL,
            `nbytes` bigint unsigned NOT NULL,
            `gz` longblob NOT NULL,
            `integrated` tinyint(1) NOT NULL,
            `crdt_version` varchar(40) NOT NULL,
            `report` json NULL,
            `created` datetime(6) NOT NULL,
            PRIMARY KEY (`doc_id`, `through_rev`)
        ) {TABLE_OPTIONS}"""
    )


def ensure_stage_table(app: str) -> None:
    """Create the staged pieces table and add the columns tables made before them lack."""
    stage_table = table(app, "stage")
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{stage_table}` (
            `doc_id` varchar(20) NOT NULL,
            `stage_id` char(32) NOT NULL,
            `idx` tinyint unsigned NOT NULL,
            `purpose` varchar(20) NOT NULL,
            `sid` char(32) NOT NULL,
            `seq_from` bigint unsigned NULL,
            `seq_to` bigint unsigned NULL,
            `total_len` int unsigned NOT NULL,
            `sha_total` binary(32) NOT NULL,
            `bytes` mediumblob NOT NULL,
            `created` datetime(6) NOT NULL,
            PRIMARY KEY (`doc_id`, `stage_id`, `idx`),
            KEY `created` (`created`)
        ) {TABLE_OPTIONS}"""
    )
    for column in STAGE_COLUMNS:
        frappe.db.sql_ddl(f"ALTER TABLE `{stage_table}` ADD COLUMN IF NOT EXISTS {column}")


def ensure_recovery_table(app: str) -> None:
    """Create the recovery copies table."""
    recovery_table = table(app, "recovery")
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{recovery_table}` (
            `id` varchar(20) NOT NULL,
            `doc_id` varchar(20) NOT NULL,
            `node` varchar(140) NOT NULL,
            `owner` varchar(140) NOT NULL,
            `reason` varchar(40) NOT NULL,
            `lineage` char(32) NOT NULL,
            `seen_rev` bigint unsigned NULL,
            `sha256` binary(32) NOT NULL,
            `nbytes` bigint unsigned NOT NULL,
            `payload` longblob NOT NULL,
            `inserted` json NULL,
            `context_rev` bigint unsigned NULL,
            `media` json NULL,
            `created` datetime(6) NOT NULL,
            `resolved_at` datetime(6) NULL,
            `resolution` varchar(40) NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `owner_sha` (`doc_id`, `owner`, `sha256`),
            KEY `open` (`doc_id`, `owner`, `resolved_at`)
        ) {TABLE_OPTIONS}"""
    )


def ensure_projection_table(app: str) -> None:
    """Create the table that records the readable copy in the app's row."""
    projection_table = table(app, "projection")
    # The rev of the checked readable copy in the app's row, and the sha of the fields it wrote
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{projection_table}` (
            `doc_id` varchar(20) NOT NULL,
            `projected_rev` bigint unsigned NOT NULL DEFAULT 0,
            `projection_hash` binary(32) NULL,
            `updated` datetime(6) NULL,
            PRIMARY KEY (`doc_id`)
        ) {TABLE_OPTIONS}"""
    )


def ensure_copy_table(app: str) -> None:
    """Create the readable copies table."""
    copy_table = table(app, "copy")
    # The checked readable copy at the latest rev
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{copy_table}` (
            `doc_id` varchar(20) NOT NULL,
            `rev` bigint unsigned NOT NULL,
            `html` longtext NULL,
            `text` longtext NULL,
            `created` datetime(6) NOT NULL,
            PRIMARY KEY (`doc_id`, `rev`)
        ) {TABLE_OPTIONS}"""
    )


def ensure_conversion_table(app: str) -> None:
    """Create the conversion records table and add the columns tables made before them lack."""
    conversion_table = table(app, "conversion")
    # `dropped` holds document text, so it is read only by this record's own checks
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{conversion_table}` (
            `node` varchar(140) NOT NULL,
            `fingerprint` char(64) NOT NULL,
            `converter_version` varchar(20) NOT NULL,
            `started` datetime(6) NOT NULL,
            `finished` datetime(6) NULL,
            `outcome` varchar(20) NULL,
            `reason` varchar(40) NULL,
            `dropped` json NULL,
            PRIMARY KEY (`node`, `fingerprint`, `converter_version`)
        ) {TABLE_OPTIONS}"""
    )
    frappe.db.sql_ddl(
        f"ALTER TABLE `{conversion_table}` ADD COLUMN IF NOT EXISTS `failures` int unsigned NOT NULL DEFAULT 0"
    )
    frappe.db.sql_ddl(f"ALTER TABLE `{conversion_table}` ADD COLUMN IF NOT EXISTS `checked` datetime(6) NULL")


def ensure_tables(app: str) -> None:
    """Create the product's tables if they are missing. Safe to run on every migrate."""
    ensure_doc_table(app)
    ensure_update_table(app)
    ensure_session_table(app)
    ensure_checkpoint_table(app)
    ensure_stage_table(app)
    ensure_recovery_table(app)
    ensure_projection_table(app)
    ensure_copy_table(app)
    ensure_conversion_table(app)
