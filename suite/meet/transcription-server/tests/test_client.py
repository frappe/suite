import hashlib
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from client import Gateway, Site
from protocol import Source, WorkError


class HttpContractTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.pcm = b"\x01\x00" * 24000
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append((self.path, dict(self.headers), data))
                body = json.dumps({"message": {"job": None, "queue": {"jobs": 0}}}).encode()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                outer.requests.append((self.path, dict(self.headers), None))
                if outer.redirect:
                    self.send_response(302)
                    self.send_header("Location", outer.url + "/unexpected")
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(outer.pcm)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.redirect = False
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.gateway = Gateway(Site(self.url, "x" * 48, (self.url,)), "worker-1")
        self.authorized = {
            "source_id": "speech-1",
            "speaker_id": "speaker-1",
            "speaker_name": "Asha",
            "start_ms": 0,
            "end_ms": 1000,
            "sample_rate": 24000,
            "size": len(self.pcm),
            "sha256": hashlib.sha256(self.pcm).hexdigest(),
            "url": self.url + "/v1/transcriptions/capture-1/segments/speech-1",
            "authorization": "Bearer segment-token",
        }

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()

    def test_frappe_uses_worker_header_and_unwraps_message(self):
        response = self.gateway.call("claim", {})
        self.assertIsNone(response["job"])
        path, headers, body = self.requests[0]
        self.assertEqual(path, "/api/method/suite.meet.api.transcription.claim")
        self.assertEqual(headers["X-Meet-Transcription-Authorization"], "Bearer " + "x" * 48)
        self.assertNotIn("Authorization", headers)
        self.assertEqual(body, {"worker_id": "worker-1"})

    def test_source_is_verified_and_only_receives_its_capability(self):
        data = self.gateway.source(Source.parse(self.authorized), self.authorized)
        self.assertEqual(data, self.pcm)
        self.assertEqual(self.requests[0][1]["Authorization"], "Bearer segment-token")
        self.assertNotIn("X-Meet-Transcription-Authorization", self.requests[0][1])

    def test_redirect_is_not_followed_with_source_credentials(self):
        self.redirect = True
        with self.assertRaises(WorkError):
            self.gateway.source(Source.parse(self.authorized), self.authorized)
        self.assertEqual(len(self.requests), 1)

    def test_source_cannot_target_unconfigured_origin(self):
        self.authorized["url"] = "https://unknown.example/v1/transcriptions/x/segments/speech-1"
        with self.assertRaisesRegex(WorkError, "source_origin_rejected"):
            self.gateway.source(Source.parse(self.authorized), self.authorized)
        self.assertEqual(self.requests, [])

    def test_corrupt_source_never_reaches_recognition(self):
        source = Source.parse(self.authorized)
        self.pcm = b"\x00" * len(self.pcm)
        with self.assertRaisesRegex(WorkError, "source_integrity_failed"):
            self.gateway.source(source, self.authorized)

    def test_https_and_strong_per_site_secrets_are_required(self):
        with self.assertRaises(ValueError):
            Site.parse({"origin": self.url, "secret": "x" * 48, "recorder_origins": [self.url]})
        with self.assertRaises(ValueError):
            Site.parse(
                {
                    "origin": "https://site.example",
                    "secret": "weak",
                    "recorder_origins": ["https://recorder.example"],
                }
            )


if __name__ == "__main__":
    unittest.main()
