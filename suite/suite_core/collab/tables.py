"""Raw InnoDB tables for one product's collaboration log.

They are not DocTypes because Frappe has no binary field type. Every table is
keyed on the control row's id, never on the Drive node.
"""

import frappe

KINDS = ("doc", "update", "session", "checkpoint")


def table(adapter: str, kind: str) -> str:
    if kind not in KINDS or not adapter.isidentifier():
        raise ValueError(f"Unknown collab table {adapter} {kind}")
    return f"__{adapter}_collab_{kind}"


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
        "`tail_bound` bigint unsigned NOT NULL DEFAULT 0",
        "`compaction_failures` int unsigned NOT NULL DEFAULT 0",
        "`next_compaction_at` datetime(6) NULL",
        "`last_compaction_ms` int unsigned NULL",
        "`last_compaction_error` varchar(140) NULL",
    ):
        frappe.db.sql_ddl(f"ALTER TABLE `{table(adapter, 'doc')}` ADD COLUMN IF NOT EXISTS {column}")
    frappe.db.sql_ddl(
        f"ALTER TABLE `{table(adapter, 'doc')}` ADD INDEX IF NOT EXISTS `next_compaction_at` (`next_compaction_at`)"
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
