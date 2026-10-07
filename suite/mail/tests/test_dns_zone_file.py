# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A domain's records as zone file lines that Route 53 imports: it is the strictest importer, wanting
a TTL on every line, absolute targets, and long TXT values as strings of 255 characters that touch."""

import unittest

from suite.mail.utils.dns import ZoneFileRecord

DOMAIN = "acme.test"
# 410 characters, as an RSA-2048 key makes it; the digits keep every chunk distinct.
RSA_DKIM = "v=DKIM1; k=rsa; p=" + "".join(f"{n:04d}" for n in range(98))


def zone_line(**record) -> str:
    """The line for a record shaped as Suite Cloud returns them: bare targets, unquoted values."""

    return str(ZoneFileRecord({"fqdn": DOMAIN, "ttl": 300, **record}))


class TestTextRecords(unittest.TestCase):
    def test_a_value_that_fits_is_one_quoted_string(self):
        self.assertEqual(
            zone_line(type="TXT", value="v=spf1 include:spf.c1.example.test -all"),
            'acme.test.\t300\tIN\tTXT\t"v=spf1 include:spf.c1.example.test -all"',
        )

    def test_a_longer_value_is_split_into_strings_that_touch(self):
        line = zone_line(type="TXT", fqdn=f"rsa._domainkey.{DOMAIN}", value=RSA_DKIM)
        first, second = RSA_DKIM[:255], RSA_DKIM[255:]
        self.assertEqual(line, f'rsa._domainkey.acme.test.\t300\tIN\tTXT\t"{first}""{second}"')

    def test_a_value_of_exactly_255_characters_is_not_split(self):
        value = "x" * 255
        self.assertEqual(zone_line(type="TXT", value=value), f'acme.test.\t300\tIN\tTXT\t"{value}"')

    def test_quotes_and_backslashes_are_escaped(self):
        self.assertEqual(
            zone_line(type="TXT", value='say "hi" \\ bye'),
            'acme.test.\t300\tIN\tTXT\t"say \\"hi\\" \\\\ bye"',
        )


class TestTargets(unittest.TestCase):
    """Without the trailing dot an importer reads ``mail.c1.example.test.acme.test``."""

    def test_mx(self):
        self.assertEqual(
            zone_line(type="MX", value="mail.c1.example.test", priority=10),
            "acme.test.\t300\tIN\tMX\t10 mail.c1.example.test.",
        )

    def test_srv(self):
        self.assertEqual(
            zone_line(
                type="SRV",
                fqdn=f"_imaps._tcp.{DOMAIN}",
                value="mail.c1.example.test",
                priority=0,
                weight=1,
                port=993,
            ),
            "_imaps._tcp.acme.test.\t300\tIN\tSRV\t0 1 993 mail.c1.example.test.",
        )

    def test_cname(self):
        self.assertEqual(
            zone_line(type="CNAME", fqdn=f"mta-sts.{DOMAIN}", value="mail.c1.example.test"),
            "mta-sts.acme.test.\t300\tIN\tCNAME\tmail.c1.example.test.",
        )

    def test_a_target_that_already_ends_in_a_dot_keeps_just_the_one(self):
        self.assertEqual(
            zone_line(type="MX", value="mail.c1.example.test.", priority=10),
            "acme.test.\t300\tIN\tMX\t10 mail.c1.example.test.",
        )


class TestTTL(unittest.TestCase):
    def test_a_record_without_a_ttl_still_gets_one(self):
        self.assertEqual(
            zone_line(type="CNAME", fqdn=f"mta-sts.{DOMAIN}", value="mail.c1.example.test", ttl=None),
            "mta-sts.acme.test.\t300\tIN\tCNAME\tmail.c1.example.test.",
        )
