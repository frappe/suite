"""Keep browsers from holding a public file's redirect longer than its link lives.

For a public file in object storage, Frappe answers `/files/...` with a 302 to
a signed link that lives an hour, marked `Cache-Control: public, max-age=1800`.
Cloudflare raises `max-age` on a `public` response to the zone's Browser Cache
TTL (4 hours by default), so a browser keeps following the link for hours after
it expired. Cloudflare leaves a `private` response's header as it is.

Remove this once Frappe marks the redirect `private` itself.
"""

from werkzeug.wrappers import Request, Response


def make_file_redirects_private(request: Request, response: Response) -> None:
    """Mark a redirect under `/files/` `private` in place of `public` (`after_request`)."""
    if response.status_code != 302 or not request.path.startswith("/files/"):
        return
    cache_control = response.headers.get("Cache-Control")
    if not cache_control:
        return
    directives = (directive.strip() for directive in cache_control.split(","))
    response.headers["Cache-Control"] = ", ".join(
        "private" if directive.lower() == "public" else directive for directive in directives
    )
