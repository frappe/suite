"""Self-hosted multi-site transcription worker and authenticated aggregate metrics."""

import hmac
import json
import os
import resource
import signal
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from client import Gateway, Site
from metrics import Metrics
from protocol import MODEL, REVISION, WorkError
from worker import FairScheduler, Processor


def log(event, code=None):
    # No site/source URLs, payloads, transcript text, credentials or exception strings.
    print(json.dumps({"event": event, **({"code": code} if code else {})}), flush=True)


def sites_from_file(path, *, allow_http=False):
    source = Path(path)
    if source.stat().st_mode & 0o007:
        raise ValueError("Worker credentials must not be world-readable")
    values = json.loads(source.read_text())
    if not isinstance(values, list) or not 1 <= len(values) <= 128:
        raise ValueError("Configure between one and 128 sites")
    sites = [Site.parse(value, allow_http=allow_http) for value in values]
    if len({site.origin for site in sites}) != len(sites):
        raise ValueError("Duplicate site origins")
    return sites


class State:
    def __init__(self, metrics):
        self.metrics = metrics
        self.ready = False
        self.scheduler = None

    def healthy(self):
        return (
            self.ready
            and self.scheduler is not None
            and self.scheduler.last_success is not None
            and (time.monotonic() - self.scheduler.last_success < 180)
        )


def serve(state, token, host, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_GET(self):
            if self.path == "/health":
                ready = state.healthy()
                body = json.dumps(
                    {"status": "ok" if ready else "unavailable", "model": MODEL, "revision": REVISION}
                ).encode()
                self.send_response(200 if ready else 503)
                content_type = "application/json"
            elif self.path == "/metrics":
                authorization = self.headers.get("Authorization", "")
                if not token or not hmac.compare_digest(authorization, "Bearer " + token):
                    self.send_response(401)
                    self.end_headers()
                    return
                state.metrics.set("healthy", int(state.healthy()))
                body = state.metrics.render().encode()
                self.send_response(200)
                content_type = "text/plain; version=0.0.4"
            else:
                self.send_response(404)
                self.end_headers()
                return
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    httpd = ThreadingHTTPServer((host, port), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def run():
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    metrics = Metrics()
    state = State(metrics)
    token_path = os.environ.get("TRANSCRIPTION_METRICS_TOKEN_FILE")
    token = Path(token_path).read_text().strip() if token_path else ""
    httpd = serve(
        state,
        token,
        os.environ.get("TRANSCRIPTION_HOST", "0.0.0.0"),
        int(os.environ.get("TRANSCRIPTION_PORT", "8011")),
    )
    try:
        sites = sites_from_file(
            os.environ["TRANSCRIPTION_SITES_FILE"],
            allow_http=os.environ.get("TRANSCRIPTION_ALLOW_HTTP") == "1",
        )
        from recognizer import TrelisRecognizer

        recognizer = TrelisRecognizer(
            os.environ.get("TRANSCRIPTION_MODEL_CACHE", "/models"),
            allocator_gib=float(os.environ.get("TRANSCRIPTION_ALLOCATOR_GIB", "7")),
        )
        worker_id = os.environ.get(
            "TRANSCRIPTION_WORKER_ID", socket.gethostname() + "-" + uuid.uuid4().hex[:12]
        )
        processor = Processor(recognizer, metrics, stop)
        scheduler = FairScheduler([Gateway(site, worker_id) for site in sites], processor, metrics)
        state.scheduler, state.ready = scheduler, True
        metrics.set("ready", 1)

        def observe():
            while not stop.is_set():
                scheduler.refresh_queues()
                for name, value in recognizer.memory().items():
                    metrics.set(name, value)
                metrics.set(
                    "resident_memory_peak_bytes", resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
                )
                stop.wait(30)

        observer = threading.Thread(target=observe, daemon=True)
        observer.start()
        log("worker_ready")
        while not stop.is_set():
            if not scheduler.step():
                stop.wait(5)
        observer.join(timeout=35)
    except WorkError as error:
        log("worker_stopped", error.code)
        return 1
    except Exception:
        log("worker_stopped", "configuration_or_runtime_failed")
        return 1
    finally:
        stop.set()
        state.ready = False
        metrics.set("ready", 0)
        httpd.shutdown()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
