# Link preview metadata for hyperlinked cells — the hover card's title /
# description / favicon (Google Sheets' link chip UX).
#
# The browser can't fetch a foreign page's HTML (CORS), so the server does it.
# That makes this endpoint an SSRF vector by construction, so every fetch goes
# through suite_core.public_http (public addresses only, pinned to the IP it
# checked), follows at most MAX_REDIRECTS redirects, and reads at most MAX_BYTES,
# HTML content types only.
# Results (including failures) are cached in Redis so hover traffic doesn't
# hammer external sites.

from urllib.parse import urljoin, urlparse

import frappe
from bs4 import BeautifulSoup
from frappe.rate_limiter import rate_limit

from suite.suite_core.public_http import REDIRECT_STATUSES, request_public

MAX_REDIRECTS = 3
MAX_BYTES = 100 * 1024
CACHE_OK_SEC = 24 * 60 * 60
CACHE_ERR_SEC = 5 * 60
USER_AGENT = "Mozilla/5.0 (compatible; FrappeSheets-LinkPreview/1.0)"


@frappe.whitelist(methods=["GET", "POST"])
@rate_limit(limit=60, seconds=60)
def get_link_preview(url: str) -> dict:
    """Fetch {title, description, favicon, host} for a cell hyperlink."""
    cache_key = f"sheets_link_preview::{url}"
    cached = frappe.cache.get_value(cache_key)
    if cached is not None:
        return cached

    try:
        result = _fetch_preview(url)
        ttl = CACHE_OK_SEC
    except Exception:
        # Unreachable host, non-HTML target, blocked address, parse error —
        # the card just degrades to the bare URL. Cache briefly so a dead
        # link hovered repeatedly doesn't retry every time.
        frappe.logger("sheets").error(f"link preview failed for {url}", exc_info=True)
        result = {"error": True}
        ttl = CACHE_ERR_SEC

    frappe.cache.set_value(cache_key, result, expires_in_sec=ttl)
    return result


def _fetch_preview(url: str) -> dict:
    final_url, html = _fetch_html(url)
    # Hand raw bytes to BeautifulSoup so it detects the page's charset itself.
    soup = BeautifulSoup(html, "html.parser")

    title = _first(
        _meta(soup, property="og:title"),
        soup.title.string if soup.title else None,
    )
    description = _first(
        _meta(soup, property="og:description"),
        _meta(soup, name="description"),
    )
    favicon = _favicon(soup, final_url)
    host = urlparse(final_url).hostname or ""
    if host.startswith("www."):
        host = host[4:]

    return {
        "title": _clip(title, 200),
        "description": _clip(description, 300),
        "favicon": favicon,
        "host": host,
    }


def _fetch_html(url: str) -> tuple[str, bytes]:
    """GET `url` with SSRF guards; returns (final_url, first MAX_BYTES of body)."""
    resp = request_public(
        "GET",
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        follow_redirects=MAX_REDIRECTS,
        max_bytes=MAX_BYTES,
    )
    if resp.status in REDIRECT_STATUSES:
        raise frappe.ValidationError("Too many redirects")
    if resp.status >= 400:
        raise frappe.ValidationError(f"HTTP {resp.status}")
    if "html" not in resp.headers.get("content-type", ""):
        raise frappe.ValidationError("Not an HTML page")
    return resp.url, resp.body


def _meta(soup, **attrs):
    tag = soup.find("meta", attrs=attrs)
    return tag.get("content") if tag else None


def _favicon(soup, base_url: str) -> str:
    link = soup.find("link", rel=lambda r: r and "icon" in str(r).lower())
    href = link.get("href") if link else None
    icon = urljoin(base_url, href or "/favicon.ico")
    # Only expose http(s) icons — data: URIs are fine to render but can be
    # megabytes; skip anything else the page might declare.
    return icon if icon.startswith(("http://", "https://")) else ""


def _first(*values):
    for v in values:
        if v and str(v).strip():
            return str(v).strip()
    return ""


def _clip(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    return text[: limit - 1] + "…" if len(text) > limit else text
