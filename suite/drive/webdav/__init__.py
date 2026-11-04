# WebDAV server for Frappe Drive (RFC 4918).
# The compliance classes are not fixed: they follow the admin's method
# allow-list, and `settings.dav_compliance` is the one place that decides them.
# Keep this module import-light: the dispatcher's before_request hook runs on
# every request, and non-/dav traffic must not pay for the protocol engine.

DAV_PREFIX = "/dav"

ALLOWED_METHODS = (
    "OPTIONS",
    "GET",
    "HEAD",
    "PUT",
    "DELETE",
    "PROPFIND",
    "PROPPATCH",
    "MKCOL",
    "COPY",
    "MOVE",
    "LOCK",
    "UNLOCK",
)


def parse_webdav_methods(raw: str | None) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Parse an admin-supplied method list into (methods, unknown_tokens).

    Tokens split on commas/whitespace, case-insensitive, returned in canonical
    ALLOWED_METHODS order. Two implications keep a partial list coherent:
    OPTIONS is always included (every client starts with the discovery
    handshake) and GET implies HEAD. Empty input means "all methods".
    """
    tokens = [token.upper() for token in (raw or "").replace(",", " ").split() if token]
    if not tokens:
        return ALLOWED_METHODS, ()

    chosen = set(tokens)
    unknown = tuple(token for token in dict.fromkeys(tokens) if token not in ALLOWED_METHODS)
    chosen.add("OPTIONS")
    if "GET" in chosen:
        chosen.add("HEAD")
    return tuple(method for method in ALLOWED_METHODS if method in chosen), unknown
