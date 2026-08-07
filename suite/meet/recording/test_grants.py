import base64
import unittest

import jwt

from suite.meet.recording.grants import (
    mint_recording_grant,
    normalize_public_jwk,
    public_jwk_thumbprint,
)

PUBLIC_JWK = {
    "kty": "EC",
    "crv": "P-256",
    "x": "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
    "y": "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
}


class TestRecordingGrants(unittest.TestCase):
    def test_rfc7638_thumbprint_fixed_vector(self):
        self.assertEqual(public_jwk_thumbprint(PUBLIC_JWK), "xx0BcA-wMohw8atYDJOe6peGModklG2wRHBlXHMvl0M")

    def test_public_jwk_validation_rejects_invalid_keys(self):
        invalid = [
            {**PUBLIC_JWK, "kty": "RSA"},
            {**PUBLIC_JWK, "crv": "P-384"},
            {**PUBLIC_JWK, "d": PUBLIC_JWK["x"]},
            {**PUBLIC_JWK, "use": "sig"},
            {**PUBLIC_JWK, "x": PUBLIC_JWK["x"] + "="},
            {**PUBLIC_JWK, "x": "AA"},
            {**PUBLIC_JWK, "x": "!" * 43},
            {**PUBLIC_JWK, "x": base64.urlsafe_b64encode(bytes(32)).rstrip(b"=").decode()},
        ]
        for jwk in invalid:
            with self.subTest(jwk=jwk), self.assertRaises(ValueError):
                normalize_public_jwk(jwk)

    def test_mints_exact_header_and_claims(self):
        token = mint_recording_grant(
            secret="fixed-secret-with-at-least-32-bytes",
            site="meet.example.test",
            meeting_id="room-1",
            recording_id="recording-1",
            recorder_job_id="job-1",
            public_jwk=PUBLIC_JWK,
            issued_at=1_800_000_000,
            expires_in=30,
            authorization_expires_at=1_800_003_600,
            max_ends_at=1_800_014_400,
            jti="grant-1",
        )

        self.assertEqual(
            jwt.get_unverified_header(token), {"alg": "HS256", "typ": "meet-recording-grant+jwt"}
        )
        claims = jwt.decode(
            token,
            "fixed-secret-with-at-least-32-bytes",
            algorithms=["HS256"],
            audience="meet-sfu-recorder",
            options={"verify_exp": False, "verify_iat": False},
        )
        self.assertEqual(
            claims,
            {
                "iss": "frappe-site:meet.example.test",
                "aud": "meet-sfu-recorder",
                "scope": "recording",
                "jti": "grant-1",
                "site": "meet.example.test",
                "meeting_id": "room-1",
                "recording_id": "recording-1",
                "recorder_job_id": "job-1",
                "cnf": {"jwk": PUBLIC_JWK, "jkt": public_jwk_thumbprint(PUBLIC_JWK)},
                "iat": 1_800_000_000,
                "exp": 1_800_000_030,
                "authorization_expires_at": 1_800_003_600,
            },
        )

    def test_rejects_long_connection_grant_and_authorization_beyond_maximum(self):
        arguments = {
            "secret": "test-secret-with-at-least-32-bytes",
            "site": "site",
            "meeting_id": "meeting",
            "recording_id": "recording",
            "recorder_job_id": "job",
            "public_jwk": PUBLIC_JWK,
            "issued_at": 100,
            "max_ends_at": 200,
        }
        with self.assertRaisesRegex(ValueError, "between 1 and 60"):
            mint_recording_grant(**arguments, expires_in=61)
        with self.assertRaisesRegex(ValueError, "must not exceed"):
            mint_recording_grant(**arguments, authorization_expires_at=201)


if __name__ == "__main__":
    unittest.main()
