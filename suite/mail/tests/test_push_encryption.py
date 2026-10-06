# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Encrypted push notifications: the site's keys, and what a server encrypts to them.

The sender side here is RFC 8291 §3.4 written out, so the expectation is the RFC's, not
the decryptor's: a body an application server produces for the site's keys reads back as
the object it pushed.
"""

import base64
import json
import secrets

import frappe
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from frappe.tests import IntegrationTestCase
from jmap.models.push import CalendarAlert, StateChange

from suite.mail.doctype.push_subscription.push_subscription import (
    get_push_subscription_keys,
    read_jmap_push,
)

CHANGE = {"@type": "StateChange", "changed": {"a1": {"Email": "s9"}}}
ALERT = {
    "@type": "CalendarAlert",
    "accountId": "a1",
    "calendarEventId": "e7",
    "uid": "5e0a9d3c-standup",
    "recurrenceId": "2026-10-05T09:00:00",
    "alertId": "a1",
}


def unbase64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def encrypt(plaintext: bytes, p256dh: str, auth: str) -> bytes:
    """An application server's side of RFC 8291 §3.4: one aes128gcm record for the receiver."""

    def hkdf(salt: bytes, secret: bytes, info: bytes, length: int) -> bytes:
        return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(secret)

    receiver = unbase64(p256dh)
    sender = ec.generate_private_key(ec.SECP256R1())
    sender_public = sender.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    shared = sender.exchange(
        ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), receiver)
    )
    secret = hkdf(unbase64(auth), shared, b"WebPush: info\x00" + receiver + sender_public, 32)
    salt = secrets.token_bytes(16)
    key = hkdf(salt, secret, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = hkdf(salt, secret, b"Content-Encoding: nonce\x00", 12)
    record = AESGCM(key).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + (4096).to_bytes(4, "big") + bytes([len(sender_public)]) + sender_public
    return header + record


class TestPushEncryption(IntegrationTestCase):
    def setUp(self) -> None:
        super().setUp()
        settings = frappe.get_doc("Mail Settings")
        settings._generate_jmap_push_keys()
        settings.reload()
        settings.enable_jmap_push_encryption = 1
        settings.save()
        self.settings = frappe.get_cached_doc("Mail Settings")

    def test_generated_keys_are_a_matching_pair(self) -> None:
        # Saving ran the validation: the private key must derive the public one.
        self.settings.validate_jmap_push_subscription_keys()

    def test_a_public_key_that_is_not_the_private_keys_is_refused(self) -> None:
        other = frappe.copy_doc(self.settings)
        other.jmap_push_p256dh = base64.urlsafe_b64encode(
            ec.generate_private_key(ec.SECP256R1())
            .public_key()
            .public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        ).decode()

        with self.assertRaises(frappe.ValidationError):
            other.validate_jmap_push_subscription_keys()

    def test_a_public_key_that_is_not_base64_is_refused(self) -> None:
        other = frappe.copy_doc(self.settings)
        other.jmap_push_p256dh = "abcde"

        with self.assertRaises(frappe.ValidationError):
            other.validate_jmap_push_subscription_keys()

    def test_the_subscription_is_given_the_public_half(self) -> None:
        keys = get_push_subscription_keys()

        self.assertEqual(keys["p256dh"], self.settings.jmap_push_p256dh)
        self.assertEqual(keys["auth"], self.settings.get_password("jmap_push_auth"))
        self.assertNotIn("private_key", keys)

    def test_a_push_encrypted_to_the_sites_keys_reads_back(self) -> None:
        keys = get_push_subscription_keys()
        body = encrypt(json.dumps(CHANGE).encode(), keys["p256dh"], keys["auth"])

        pushed = read_jmap_push(body, encrypted=True)

        self.assertIsInstance(pushed, StateChange)
        self.assertEqual(pushed.to_wire(), CHANGE)

    def test_a_calendar_alert_reads_back_with_its_occurrence(self) -> None:
        keys = get_push_subscription_keys()
        body = encrypt(json.dumps(ALERT).encode(), keys["p256dh"], keys["auth"])

        pushed = read_jmap_push(body, encrypted=True)

        self.assertIsInstance(pushed, CalendarAlert)
        self.assertEqual((pushed.account_id, pushed.calendar_event_id), ("a1", "e7"))
        # What the alert job is handed: the wire form, occurrence included, as the server sent it.
        self.assertEqual(pushed.to_wire(), ALERT)

    def test_a_body_sent_as_base64_text_reads_back_too(self) -> None:
        keys = get_push_subscription_keys()
        body = encrypt(json.dumps(CHANGE).encode(), keys["p256dh"], keys["auth"])

        self.assertEqual(read_jmap_push(base64.urlsafe_b64encode(body), encrypted=True).to_wire(), CHANGE)

    def test_an_unencrypted_push_is_the_json_itself(self) -> None:
        pushed = read_jmap_push(json.dumps(CHANGE).encode(), encrypted=False)

        self.assertIsInstance(pushed, StateChange)
        self.assertEqual(pushed.changed, {"a1": {"Email": "s9"}})

    def test_a_push_for_other_keys_is_refused(self) -> None:
        stranger = ec.generate_private_key(ec.SECP256R1())
        p256dh = base64.urlsafe_b64encode(
            stranger.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        ).decode()
        body = encrypt(json.dumps(CHANGE).encode(), p256dh, get_push_subscription_keys()["auth"])

        with self.assertRaises(frappe.ValidationError):
            read_jmap_push(body, encrypted=True)

    def test_anything_but_a_push_object_is_refused(self) -> None:
        for body in (b"[]", b"{not json", b'{"@type": "Response"}'):
            with self.subTest(body=body), self.assertRaises(frappe.ValidationError):
                read_jmap_push(body, encrypted=False)

    def test_without_keys_nothing_can_be_decrypted(self) -> None:
        settings = frappe.get_doc("Mail Settings")
        settings.update(
            {
                "enable_jmap_push_encryption": 0,
                "jmap_push_p256dh": None,
                "jmap_push_private_key": None,
                "jmap_push_auth": None,
            }
        )
        settings.save()

        self.assertIsNone(get_push_subscription_keys())
        with self.assertRaises(frappe.ValidationError):
            read_jmap_push(b"anything", encrypted=True)
