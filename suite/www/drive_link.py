# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Resolve one Drive share link and hand the browser the node it addresses.

`GET /l/<token>` is a website route, not an API route (§11.2). The node id
never appears in a shared URL: the server looks the token up, answers 302 to
the node's address from `drive.node_url`, and seeds the token in the URL
fragment so the client can present it in `X-Drive-Links` on every following
request (§6.2). With `suite_flip_files` on, a folder opens at `/drive/f/<id>`
and every other kind at `/d/<id>`; with it off, at `/drive/g/<id>`. No slug is
sent: the router adds it. Rotating a link mints a new token, which changes this
URL and leaves the old one resolving to nothing.

`GET /drive/l/<token>` is the old address of the same page. It answers here,
through the same resolver, until the composition redirect table sends it to
`/l/<token>` (unified frontend spec §14.3).

No role is checked here. Resolution answers *which* node, never *whether*: a
password link's holder needs the node id in order to be told, by the ordinary
node route, that it is locked (§4.8), and every request the SPA then makes is
authorized on its own from the token it presents. Only two refusals exist, and
they are the two §6.4 keeps apart - a token that names no grant (404), and a
token whose grants are all past their expiry (410).
"""

import frappe
from frappe import _

from suite import drive

no_cache = 1

# The token rides the fragment, not the query string. A fragment is never sent
# to a server, so it stays out of the reverse proxy's access log, out of
# Frappe's, and out of the `Referer` on every outbound link and third-party
# subresource the SPA loads. It is a bearer capability with no expiry unless
# the grant sets one (§6.1), and a query string would publish it to all three.
# The SPA reads it from `location.hash` and stores it as §6.2 describes.
TOKEN_PARAM = "link"


def get_context(context):
    token = frappe.form_dict.get("token")
    try:
        resolved = drive.resolve_share_link(token)
        address = drive.node_url(resolved["node"])
    except drive.DriveError as refusal:
        context.no_cache = 1
        context.title = _("Link unavailable")
        context.message = str(refusal)
        context.http_status_code = refusal.http_status_code
        return context

    frappe.flags.redirect_location = f"{address}#{TOKEN_PARAM}={resolved['token']}"
    raise frappe.Redirect(302)
