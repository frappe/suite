"""Raw InnoDB tables for one product's collaboration log.

They are not DocTypes because Frappe has no binary field type. Every table is
keyed on the control row's id, never on the Drive node.
"""

import frappe

KINDS = ("doc", "update", "session", "checkpoint", "stage", "recovery")


def table(adapter: str, kind: str) -> str:
    if kind not in KINDS or not adapter.isidentifier():
        raise ValueError(f"Unknown content table {adapter} {kind}")
    return f"__{adapter}_content_{kind}"


def ensure_tables(adapter: str) -> None:
    """Create the product's tables if they are missing. Safe to run on every migrate."""
    options = "ENGINE=InnoDB ROW_FORMAT=DYNAMIC CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{table(adapter, "doc")}` (
            `id` varchar(20) NOT NULL,
            `node` varchar(140) NOT NULL,
            `lineage` char(32) NOT NULL,
            `head_rev` bigint unsigned NOT NULL DEFAULT 0,
            `head_chain` binary(32) NOT NULL,
            `created` datetime(6) NOT NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `node` (`node`)
        ) {options}"""
    )
    for column in (
        "`checkpoint_rev` bigint unsigned NOT NULL DEFAULT 0",
        "`checkpoint_chain` binary(32) NULL",
        "`integrated_rev` bigint unsigned NOT NULL DEFAULT 0",
        "`kernel_schema` varchar(40) NULL",
        "`state_bytes` bigint unsigned NOT NULL DEFAULT 0",
        "`tail_rows` bigint unsigned NOT NULL DEFAULT 0",
        "`tail_bytes` bigint unsigned NOT NULL DEFAULT 0",
        # The most the tail can add to the next compaction: the sum of its rows' bounds (capacity.bound)
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
    ):
        frappe.db.sql_ddl(f"ALTER TABLE `{table(adapter, 'doc')}` ADD COLUMN IF NOT EXISTS {column}")
    frappe.db.sql_ddl(
        f"ALTER TABLE `{table(adapter, 'doc')}` ADD INDEX IF NOT EXISTS `next_compaction_at` (`next_compaction_at`)"
    )
    # A bound is never below its row's bytes, so this only meets tails stored before bounds were kept
    frappe.db.sql(
        f"UPDATE `{table(adapter, 'doc')}` SET `tail_bound` = `tail_bytes` WHERE `tail_bound` < `tail_bytes`"
    )
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{table(adapter, "update")}` (
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
        ) {options}"""
    )
    # Tables made before per-seq shas were kept
    frappe.db.sql_ddl(
        f"ALTER TABLE `{table(adapter, 'update')}` ADD COLUMN IF NOT EXISTS `seq_shas` longblob NOT NULL AFTER `sha256`"
    )
    # The schema of the build that wrote each row; every row before stamps came from the first
    frappe.db.sql_ddl(
        f"ALTER TABLE `{table(adapter, 'update')}` ADD COLUMN IF NOT EXISTS `schema` smallint unsigned NOT NULL DEFAULT 1 AFTER `client_id`"
    )
    # A quarantined row keeps its rev, sha and chain; its payload is emptied and kept as a recovery row
    frappe.db.sql_ddl(
        f"ALTER TABLE `{table(adapter, 'update')}` ADD COLUMN IF NOT EXISTS `state` varchar(20) NOT NULL DEFAULT 'ok'"
    )
    # What the row can add to a compaction; rows stored before it count their bytes
    frappe.db.sql_ddl(
        f"ALTER TABLE `{table(adapter, 'update')}` ADD COLUMN IF NOT EXISTS `bound` bigint unsigned NULL AFTER `payload`"
    )
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{table(adapter, "session")}` (
            `doc_id` varchar(20) NOT NULL,
            `sid` char(32) NOT NULL,
            `client_id` int unsigned NOT NULL,
            `principal` varchar(140) NOT NULL,
            `acked_seq` bigint unsigned NOT NULL DEFAULT 0,
            `created` datetime(6) NOT NULL,
            `last_push_at` datetime(6) NULL,
            PRIMARY KEY (`doc_id`, `sid`),
            UNIQUE KEY `client` (`doc_id`, `client_id`)
        ) {options}"""
    )
    # NULL until `backfill_clocks` reads it from sessions made before it was kept
    frappe.db.sql_ddl(
        f"ALTER TABLE `{table(adapter, 'session')}` ADD COLUMN IF NOT EXISTS `next_clock` bigint unsigned NULL AFTER `acked_seq`"
    )
    # A session that wrote a quarantined row may push no more
    frappe.db.sql_ddl(
        f"ALTER TABLE `{table(adapter, 'session')}` ADD COLUMN IF NOT EXISTS `closed` tinyint(1) NOT NULL DEFAULT 0"
    )
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{table(adapter, "checkpoint")}` (
            `doc_id` varchar(20) NOT NULL,
            `through_rev` bigint unsigned NOT NULL,
            `chain` binary(32) NOT NULL,
            `sha256` binary(32) NOT NULL,
            `nbytes` bigint unsigned NOT NULL,
            `gz` longblob NOT NULL,
            `integrated` tinyint(1) NOT NULL,
            `kernel_schema` varchar(40) NOT NULL,
            `report` json NULL,
            `created` datetime(6) NOT NULL,
            PRIMARY KEY (`doc_id`, `through_rev`)
        ) {options}"""
    )
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{table(adapter, "stage")}` (
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
        ) {options}"""
    )
    frappe.db.sql_ddl(
        f"""CREATE TABLE IF NOT EXISTS `{table(adapter, "recovery")}` (
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
        ) {options}"""
    )
