"""Optional built-image smoke: real model startup, fixture queue, HTTP and shutdown.

No production queue credentials or meeting data are required.
"""

import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def request(url, token=None):
    headers = {"Authorization": "Bearer " + token} if token else {}
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=3)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read().decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", required=True)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    worker_secret, metrics_secret = secrets.token_hex(32), secrets.token_hex(32)
    calls = {"claim": 0, "queue_status": 0, "rejected": 0}

    class Queue(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            operation = self.path.rsplit(".", 1)[-1]
            authorized = self.headers.get("X-Meet-Transcription-Authorization") == "Bearer " + worker_secret
            if operation not in ("claim", "queue_status") or not authorized:
                calls["rejected"] += 1
                self.send_response(403)
                self.end_headers()
                return
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            calls[operation] += 1
            result = {"queue": {"jobs": 0, "audio_seconds": 0, "oldest_age_seconds": 0}}
            if operation == "claim":
                result["job"] = None
            body = json.dumps({"message": result}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    queue = ThreadingHTTPServer(("127.0.0.1", 0), Queue)
    threading.Thread(target=queue.serve_forever, daemon=True).start()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    began = time.monotonic()
    process = None
    try:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            origin = f"http://127.0.0.1:{queue.server_port}"
            sites = temporary / "sites.json"
            sites.write_text(
                json.dumps([{"origin": origin, "secret": worker_secret, "recorder_origins": [origin]}])
            )
            sites.chmod(0o600)
            metrics = temporary / "metrics-token"
            metrics.write_text(metrics_secret)
            metrics.chmod(0o600)
            environment = {
                **os.environ,
                "TRANSCRIPTION_SITES_FILE": str(sites),
                "TRANSCRIPTION_METRICS_TOKEN_FILE": str(metrics),
                "TRANSCRIPTION_MODEL_CACHE": args.cache,
                "TRANSCRIPTION_ALLOW_HTTP": "1",
                "TRANSCRIPTION_HOST": "127.0.0.1",
                "TRANSCRIPTION_PORT": str(port),
            }
            with (temporary / "worker.log").open("w+") as log:
                process = subprocess.Popen(
                    [sys.executable, str(Path(__file__).resolve().parents[1] / "server.py")],
                    env=environment,
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
                base = f"http://127.0.0.1:{port}"
                while time.monotonic() - began < args.timeout:
                    if process.poll() is not None:
                        raise RuntimeError("service_exited_before_ready")
                    try:
                        if request(base + "/health")[0] == 200 and calls["claim"] and calls["queue_status"]:
                            break
                    except (urllib.error.URLError, TimeoutError, OSError):
                        pass
                    time.sleep(0.25)
                else:
                    raise RuntimeError("service_readiness_timeout")
                assert request(base + "/metrics")[0] == 401
                assert request(base + "/metrics", "incorrect-capability")[0] == 401
                status, body = request(base + "/metrics", metrics_secret)
                assert status == 200
                values = dict(line.split(" ", 1) for line in body.splitlines() if not line.startswith("#"))
                for name in ("ready", "healthy", "configured_sites", "observed_sites"):
                    assert float(values["meet_transcription_" + name]) == 1
                assert request(base + "/transcribe")[0] == 404
                assert calls["rejected"] == 0
                shutdown = time.monotonic()
                process.terminate()
                assert process.wait(timeout=45) == 0
                log.seek(0)
                output = log.read()
                assert worker_secret not in output and metrics_secret not in output
                print(
                    json.dumps(
                        {
                            "status": "passed",
                            "python": sys.version.split()[0],
                            "ready_seconds": round(shutdown - began, 3),
                            "shutdown_seconds": round(time.monotonic() - shutdown, 3),
                            "authenticated_queue_calls": calls["claim"] + calls["queue_status"],
                            "metrics_authentication": "passed",
                            "credential_log_check": "passed",
                        }
                    )
                )
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        queue.shutdown()
        queue.server_close()


if __name__ == "__main__":
    main()
