# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""Requests to the public internet made on a user's behalf: a hyperlink's preview, a mailing list's
unsubscribe. The URL comes from someone else (a cell, a mail header), which makes every such request
an SSRF vector by construction, so each one:

* allows only http/https on default ports,
* resolves the hostname, refuses private / loopback / link-local / reserved address space, and then
  CONNECTS TO THAT EXACT IP — the Host header, TLS SNI and cert hostname stay the original name, so
  the address checked is the address talked to. A rebinding nameserver can't hand a public IP to the
  check and a private one to the connection (re-done per redirect),
* follows redirects only as far as the caller allows, manually,
* reads at most `max_bytes` with a short timeout.

Refusals — a blocked address, a host that doesn't resolve, too many redirects — raise
`frappe.ValidationError`; a network failure raises urllib3's own errors. No transaction is involved.
"""

import ipaddress
import socket
from typing import NamedTuple
from urllib.parse import urljoin, urlparse

import certifi
import frappe
import urllib3

CONNECT_TIMEOUT = 3
READ_TIMEOUT = 4
REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class PublicResponse(NamedTuple):
    url: str
    status: int
    headers: urllib3.HTTPHeaderDict
    body: bytes


def request_public(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    follow_redirects: int = 0,
    max_bytes: int = 100 * 1024,
) -> PublicResponse:
    """Sends `method` to `url`, a public http(s) address, and returns the answer: the final URL after
    any redirects followed, its status, headers and the first `max_bytes` of its body. A redirect
    beyond `follow_redirects` is returned as it is, so with none followed a 3xx is the answer."""

    current = url
    for _ in range(follow_redirects + 1):
        ip, host, port, scheme, path = _resolve_public(current)
        pool = _pinned_pool(ip, host, port, scheme)
        try:
            resp = pool.urlopen(
                method,
                path,
                body=body,
                headers={"Host": host, **(headers or {})},
                redirect=False,
                preload_content=False,
                decode_content=True,
            )
            location = resp.headers.get("location")
            if resp.status in REDIRECT_STATUSES and location and follow_redirects:
                follow_redirects -= 1
                current = urljoin(current, location)
                continue
            return PublicResponse(current, resp.status, resp.headers, resp.read(max_bytes))
        finally:
            pool.close()
    raise frappe.ValidationError("Too many redirects")


def _pinned_pool(ip: str, host: str, port: int, scheme: str):
    """Connection pool bound to the pre-validated IP, but presenting the original
    hostname for Host header, TLS SNI, and cert verification."""
    timeout = urllib3.Timeout(connect=CONNECT_TIMEOUT, read=READ_TIMEOUT)
    if scheme == "https":
        return urllib3.HTTPSConnectionPool(
            ip,
            port=port,
            maxsize=1,
            retries=False,
            timeout=timeout,
            cert_reqs="CERT_REQUIRED",
            ca_certs=certifi.where(),
            server_hostname=host,
            assert_hostname=host,
        )
    return urllib3.HTTPConnectionPool(ip, port=port, maxsize=1, retries=False, timeout=timeout)


def _resolve_public(url: str) -> tuple[str, str, int, str, str]:
    """Resolve `url`'s host, reject non-public targets, and return the exact IP to
    connect to plus (host, port, scheme, path+query)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise frappe.ValidationError("Only http/https URLs allowed")
    if parsed.port not in (None, 80, 443):
        raise frappe.ValidationError("Non-standard port not allowed")
    host = parsed.hostname
    if not host:
        raise frappe.ValidationError("Invalid URL")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    # Resolve every A/AAAA record and reject if ANY is non-public — a rebinding
    # nameserver can rotate which record it hands out, so one bad answer taints
    # the name. We then connect to the first (validated) IP directly.
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise frappe.ValidationError("Host not resolvable")
    pinned_ip = None
    for info in infos:
        ip = str(info[4][0])
        addr = ipaddress.ip_address(ip)
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        ):
            raise frappe.ValidationError("Address not allowed")
        if pinned_ip is None:
            pinned_ip = ip
    if pinned_ip is None:
        raise frappe.ValidationError("Host not resolvable")
    path = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
    return pinned_ip, host, port, parsed.scheme, path
