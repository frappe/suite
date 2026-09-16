# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Resolve one Drive share link and hand the browser the node it addresses.

`GET /drive/l/<token>` is a website route, not an API route (§11.2). The node
id never appears in a shared URL: the server looks the token up, redirects to
the SPA's node address, and seeds the token in the URL fragment so the client
can present it in `X-Drive-Links` on every following request (§6.2). Rotating a
link mints a new token, which changes this URL and leaves the old one resolving
to nothing.

No role is checked here. Resolution answers *which* node, never *whether*: a
password link's holder needs the node id in order to be told, by the ordinary
node route, that it is locked (§4.8), and every request the SPA then makes is
authorized on its own from the token it presents. Only two refusals exist, and
they are the two §6.4 keeps apart - a token that names no grant, and a token
whose grants are all past their expiry.
"""

import frappe
from frappe import _

from suite import drive

no_cache = 1

# The SPA's kind-agnostic node address. It reads the node once and forwards to
# the file or folder page itself, which is what keeps this route from having to
# know Drive's node kinds.
NODE_ROUTE = "/drive/g/"
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
    except drive.DriveError as refusal:
        context.no_cache = 1
        context.title = _("Link unavailable")
        context.message = str(refusal)
        context.http_status_code = refusal.http_status_code
        return context

    frappe.flags.redirect_location = f"{NODE_ROUTE}{resolved['node']}#{TOKEN_PARAM}={resolved['token']}"
    raise frappe.Redirect(302)
