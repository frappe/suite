import click
import frappe

# Moved to the Suite Cloud app, child tables included.
MOVED_DOCTYPES = (
    "Mail Cluster",
    "Mail Cluster Store",
    "Mail Cluster Store HTTP Auth",
    "Mail Server",
    "Server Deployment",
    "Server Deployment Service",
    "Server Job",
    "Server Job Command",
    "Server Ansible Play",
    "Server Ansible Play Variable",
    "Server Ansible Play Task",
    "DNS Record",
)

# A row in any of these means the site deployed mail servers through Suite.
DATA_DOCTYPES = ("Mail Cluster", "Mail Server", "DNS Record")


def execute() -> None:
    """Releases the mail server deployment DocTypes to the Suite Cloud app.

    With Suite Cloud installed its own sync has already retagged them, so there is nothing to do.
    Otherwise the DocType records go, so nothing resolves to controllers Suite no longer ships.
    Tables that hold data stay (clusters carry the SSH keys that reach the servers) and are adopted
    as they are when Suite Cloud is installed later; empty ones are dropped. The retired
    cluster/server backfills (SSH keypair, recovery admin, recovery port, bootstrap plan) run again
    in Suite Cloud's installer at adoption, so rows that never saw them are completed there.
    """

    if "suite_cloud" in frappe.get_installed_apps():
        return

    keep_tables = has_deployment_data()

    for doctype in MOVED_DOCTYPES:
        frappe.delete_doc(
            "DocType",
            doctype,
            force=True,
            ignore_permissions=True,
            ignore_missing=True,
            delete_permanently=True,
        )
        if not keep_tables:
            drop_table(doctype)

    if keep_tables:
        click.secho(
            "Mail server deployment data (clusters, servers, DNS records) was kept for the Suite Cloud app. "
            "Install suite_cloud on this site to keep managing it.",
            fg="yellow",
        )


def has_deployment_data() -> bool:
    return any(frappe.db.table_exists(doctype) and has_rows(doctype) for doctype in DATA_DOCTYPES)


def has_rows(doctype: str) -> bool:
    table = frappe.qb.DocType(doctype)
    return bool(frappe.qb.from_(table).select(table.name).limit(1).run())


def drop_table(doctype: str) -> None:
    # DDL, so it goes through sql_ddl rather than the builder's run(); the builder still
    # renders the name with the right quoting for the database in use.
    frappe.db.sql_ddl(frappe.qb.drop_table(frappe.qb.DocType(doctype)).if_exists().get_sql())
