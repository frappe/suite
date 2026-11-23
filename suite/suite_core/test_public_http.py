# Copyright (c) 2026, Asif and Contributors
# See license.txt
"""SSRF guard for requests to the public internet — the security-critical piece."""

from __future__ import annotations

import unittest
from unittest import mock

import frappe

from suite.suite_core.public_http import _resolve_public


def _addrinfo(*ips):
    return [(None, None, None, None, (ip, 0)) for ip in ips]


class AssertPublicHttpUrl(unittest.TestCase):
    def _allow(self, url, resolves_to="93.184.216.34"):
        with mock.patch(
            "suite.suite_core.public_http.socket.getaddrinfo", return_value=_addrinfo(resolves_to)
        ):
            _resolve_public(url)  # must not raise

    def _block(self, url, resolves_to="93.184.216.34"):
        with mock.patch(
            "suite.suite_core.public_http.socket.getaddrinfo", return_value=_addrinfo(resolves_to)
        ):
            with self.assertRaises(frappe.ValidationError):
                _resolve_public(url)

    def test_public_https_url_passes(self):
        self._allow("https://frappe.io/")
        self._allow("http://example.com/page?x=1")

    def test_non_http_schemes_blocked(self):
        self._block("ftp://example.com/")
        self._block("file:///etc/passwd")
        self._block("gopher://example.com/")

    def test_non_standard_ports_blocked(self):
        self._block("http://example.com:8080/")
        self._block("https://example.com:6379/")

    def test_literal_private_and_loopback_ips_blocked(self):
        self._block("http://127.0.0.1/", resolves_to="127.0.0.1")
        self._block("http://10.1.2.3/", resolves_to="10.1.2.3")
        self._block("http://192.168.0.10/", resolves_to="192.168.0.10")
        self._block("http://169.254.169.254/", resolves_to="169.254.169.254")  # cloud metadata
        self._block("http://[::1]/", resolves_to="::1")

    def test_dns_pointing_at_private_space_blocked(self):
        # A public-looking name whose A record is internal (DNS-based SSRF).
        self._block("https://innocent.example.com/", resolves_to="10.0.0.5")

    def test_mixed_resolution_blocked_if_any_ip_private(self):
        with mock.patch(
            "suite.suite_core.public_http.socket.getaddrinfo",
            return_value=_addrinfo("93.184.216.34", "127.0.0.1"),
        ):
            with self.assertRaises(frappe.ValidationError):
                _resolve_public("https://tricky.example.com/")

    def test_unresolvable_host_blocked(self):
        import socket as _socket

        with mock.patch("suite.suite_core.public_http.socket.getaddrinfo", side_effect=_socket.gaierror):
            with self.assertRaises(frappe.ValidationError):
                _resolve_public("https://no-such-host.invalid/")
