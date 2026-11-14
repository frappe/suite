import json
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from metrics import Metrics
from server import State, serve, sites_from_file


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.state = State(Metrics())
        self.server = serve(self.state, "private-metrics-secret", "127.0.0.1", 0)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def request(self, path, token=None):
        request = urllib.request.Request(self.origin + path)
        if token:
            request.add_header("Authorization", "Bearer " + token)
        try:
            response = urllib.request.urlopen(request, timeout=2)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_health_requires_model_and_recent_authenticated_queue_access(self):
        self.assertEqual(self.request("/health")[0], 503)
        self.state.ready = True
        self.state.scheduler = SimpleNamespace(last_success=None)
        self.assertEqual(self.request("/health")[0], 503)
        self.state.scheduler.last_success = time.monotonic()
        status, body = self.request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "ok")
        self.state.scheduler.last_success -= 181
        self.assertEqual(self.request("/health")[0], 503)

    def test_metrics_require_capability_and_no_upload_endpoint_exists(self):
        self.assertEqual(self.request("/metrics")[0], 401)
        self.assertEqual(self.request("/metrics", "wrong")[0], 401)
        status, body = self.request("/metrics", "private-metrics-secret")
        self.assertEqual(status, 200)
        self.assertIn(b"meet_transcription_queued_jobs", body)
        self.assertNotIn(b"private-metrics-secret", body)
        self.assertEqual(self.request("/transcribe")[0], 404)

    def test_world_readable_site_credentials_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sites.json"
            path.write_text("[]")
            path.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "world-readable"):
                sites_from_file(path)


if __name__ == "__main__":
    unittest.main()
