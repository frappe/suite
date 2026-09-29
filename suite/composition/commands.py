"""Bench commands of the suite app. `suite/commands.py` hands them to bench."""

import click
from frappe.commands import get_site, pass_context


@click.command("drive-legacy-calls")
@click.option("--json", "as_json", is_flag=True, help="Print the rows and the total as JSON.")
@pass_context
def drive_legacy_calls(context, as_json: bool):
    """Print every legacy Drive call counted on the site, latest first (Drive spec §11.7)."""
    import frappe

    from suite.drive.http.legacy_calls import report

    frappe.init(get_site(context))
    frappe.connect()
    try:
        click.echo(report(as_json=as_json))
    finally:
        frappe.destroy()


commands = [drive_legacy_calls]
