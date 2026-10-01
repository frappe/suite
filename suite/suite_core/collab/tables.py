"""Raw InnoDB tables for one product's collaboration log.

They are not DocTypes because Frappe has no binary field type. Every table is
keyed on the control row's id, never on the Drive node.
"""

import frappe

KINDS = ("doc", "update", "session")


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
