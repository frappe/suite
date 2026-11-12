"""Frappe lifecycle adapters for Mail's request-scoped resources."""

import frappe


def close_mail_clients() -> None:
    """Close Mail HTTP pools after a request or background job finishes."""
    clients = getattr(frappe.local, "mail_http_clients", [])
    frappe.local.mail_http_clients = []
    for client in clients:
        client.close()
