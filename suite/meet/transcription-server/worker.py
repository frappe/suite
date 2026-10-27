"""Fair multi-site coordinator with fenced leases and resumable segment results."""

import copy
import math
import threading
import time
from collections.abc import Callable

from protocol import Source, WorkError, sources, validate_hints, validate_model


def validate_progress(values: list, expected: dict[str, Source]) -> dict[str, dict]:
    if not isinstance(values, list):
        raise WorkError("invalid_progress")
    result = {}
    for value in values:
        if not isinstance(value, dict) or value.get("source_id") not in expected:
            raise WorkError("invalid_progress")
        source = expected[value["source_id"]]
        canonical = source.result(value.get("text"))
        if value != canonical or source.source_id in result:
            raise WorkError("invalid_progress")
        result[source.source_id] = canonical
    return result


def validate_gaps(values: list) -> list:
    from protocol import number, text

    if not isinstance(values, list) or len(values) > 10000:
        raise WorkError("invalid_manifest")
    result = []
    for value in values:
        if not isinstance(value, dict):
            raise WorkError("invalid_manifest")
        start, end = number(value.get("start_ms")), number(value.get("end_ms"))
        if end < start:
            raise WorkError("invalid_manifest")
        result.append({"start_ms": start, "end_ms": end, "reason": text(value.get("reason"))})
    return result


class Lease:
    def __init__(self, gateway, job: dict, interval=30):
        self.gateway = gateway
        self.identity = {"job": job["job"], "lease_token": job["lease_token"]}
        self.manifest = copy.deepcopy(job["manifest"])
        self.original_sources = sources(self.manifest)
        self.results = {}
        self.error = None
        self.interval = interval
        self.done = threading.Event()
        self.lock = threading.Lock()
        self.thread = None

    def checkpoint(self, results: dict):
        with self.lock:
            self.results = copy.deepcopy(results)

    def snapshot(self, source_id: str) -> dict:
        with self.lock:
            if self.error:
                raise self.error
            for item in self.manifest["segments"]:
                if item["source_id"] == source_id:
                    return copy.deepcopy(item)
        raise WorkError("source_manifest_changed")

    def heartbeat(self):
        with self.lock:
            segments = list(self.results.values())
        update = self.gateway.call(
            "heartbeat",
            {
                **self.identity,
                "segments": segments,
                "processed_source_ids": [item["source_id"] for item in segments],
            },
        )
        if "manifest" in update:
            if sources(update["manifest"]) != self.original_sources:
                raise WorkError("source_manifest_changed")
            with self.lock:
                self.manifest = copy.deepcopy(update["manifest"])

    def _keep_alive(self):
        while not self.done.wait(self.interval):
            try:
                self.heartbeat()
            except WorkError as error:
                with self.lock:
                    self.error = error
                return
            except Exception:
                with self.lock:
                    self.error = WorkError("heartbeat_failed", transient=True)
                return

    def start(self):
        # Refresh capabilities and establish the lease before expensive work.
        self.heartbeat()
        self.thread = threading.Thread(target=self._keep_alive, daemon=True)
        self.thread.start()

    def stop(self):
        self.done.set()
        if self.thread:
            self.thread.join(timeout=35)

    def check(self):
        with self.lock:
            if self.error:
                raise self.error


class Processor:
    def __init__(self, recognizer, metrics, stop: threading.Event, *, lease_interval=30):
        self.recognizer, self.metrics, self.shutdown = recognizer, metrics, stop
        self.lease_interval = lease_interval

    def _failure(self, gateway, job, results, code, transient):
        response = gateway.call(
            "fail",
            {
                "job": job["job"],
                "lease_token": job["lease_token"],
                "code": code,
                "transient": transient,
                "segments": list(results.values()),
                "processed_source_ids": list(results),
            },
        )
        if response.get("status") == "Queued":
            self.metrics.add("retries_scheduled_total", 1)
        elif response.get("status") == "Partial":
            self.metrics.add("jobs_partial_total", 1)
        elif response.get("status") == "Failed":
            self.metrics.add("jobs_terminal_failed_total", 1)
        self.metrics.observe("capture_end_to_ready_seconds", response.get("capture_end_to_ready_seconds"))

    def process(self, gateway, job: dict):
        results = {}
        lease = None
        began = time.monotonic()
        self.metrics.set("active_jobs", 1)
        try:
            validate_model(job.get("model"))
            try:
                hints = validate_hints(job.get("hints"))
            except ValueError:
                raise WorkError("invalid_recognition_hints") from None
            if hints["vocabulary_version"] != job["model"]["configuration"]["vocabulary_version"]:
                raise WorkError("unsupported_model_configuration")
            segments = sources(job.get("manifest"))
            expected = {item.source_id: item for item in segments}
            results = validate_progress(job.get("completed_segments", []), expected)
            gaps = validate_gaps(job["manifest"].get("gaps", []))
            lease = Lease(gateway, job, self.lease_interval)
            lease.checkpoint(results)
            lease.start()
            failed_source = None
            retryable_source = False
            for source in segments:
                if self.shutdown.is_set():
                    raise WorkError("worker_shutdown", transient=True)
                lease.check()
                if source.source_id in results:
                    continue
                try:
                    data = gateway.source(source, lease.snapshot(source.source_id))
                    # Pure digital silence must not become a model hallucination.
                    # No amplitude threshold is used: quiet speech remains intact.
                    transcript = (
                        self.recognizer.transcribe(
                            data,
                            source.sample_rate,
                            hints=copy.deepcopy(hints),
                            speaker_name=source.speaker_name,
                        )
                        if any(data)
                        else ""
                    )
                except WorkError as error:
                    if error.code == "authorization_or_lease_rejected":
                        raise
                    failed_source = failed_source or error
                    retryable_source = retryable_source or error.transient
                    # One bad source must not hide healthy later speakers. The
                    # failure callback checkpoints all recovered results before
                    # the site's bounded retry/partial-publication decision.
                    continue
                if self.shutdown.is_set():
                    raise WorkError("worker_shutdown", transient=True)
                lease.check()
                results[source.source_id] = source.result(transcript)
                lease.checkpoint(results)
                self.metrics.add("processed_audio_seconds_total", len(data) / 2 / source.sample_rate)
                self.metrics.add("segments_completed_total", 1)
            # Stop/join the heartbeat before finalization so it cannot race the
            # successful completion or update a subsequently reused lease.
            lease.stop()
            lease.check()
            if failed_source:
                raise WorkError(failed_source.code, transient=retryable_source)
            ordered = [results[item.source_id] for item in segments]
            completion = gateway.call(
                "complete",
                {
                    **lease.identity,
                    "segments": ordered,
                    "processed_source_ids": [item.source_id for item in segments],
                    "gaps": gaps,
                    "partial": bool(gaps) or bool(job["manifest"].get("partial")),
                },
            )
            self.metrics.add("jobs_completed_total", 1)
            if completion.get("status") == "Partial":
                self.metrics.add("jobs_partial_total", 1)
            self.metrics.observe(
                "capture_end_to_ready_seconds", completion.get("capture_end_to_ready_seconds")
            )
        except WorkError as error:
            if lease:
                lease.stop()
            self.metrics.add("jobs_failed_total", 1)
            if error.code != "authorization_or_lease_rejected":
                self._failure(gateway, job, results, error.code, error.transient)
            return error.code
        except Exception:
            if lease:
                lease.stop()
            self.metrics.add("jobs_failed_total", 1)
            # Error strings may contain waveform paths or model output. Send an
            # enumerated reason only; completed segments are durable retry input.
            self._failure(gateway, job, results, "inference_failed", True)
            return "inference_failed"
        finally:
            elapsed = time.monotonic() - began
            self.metrics.add("processing_seconds_total", elapsed)
            self.metrics.observe("job_processing_duration_seconds", elapsed)
            self.metrics.set("active_jobs", 0)


class FairScheduler:
    """One shared pool, round-robin across durable site queues, atomic site leases."""

    def __init__(self, gateways: list, processor, metrics, *, clock: Callable = time.monotonic):
        if not gateways:
            raise ValueError("Configure at least one site")
        self.gateways, self.processor, self.metrics, self.clock = gateways, processor, metrics, clock
        self.next_site = 0
        self.last_success = None
        self.snapshots = {}
        self.snapshot_times = {}
        self.started = self.clock()
        self.observation_lock = threading.Lock()
        self.metrics.set("configured_sites", len(gateways))

    def step(self):
        for _ in self.gateways:
            index = self.next_site
            self.next_site = (index + 1) % len(self.gateways)
            gateway = self.gateways[index]
            try:
                job = gateway.call("claim", {})
                self.last_success = self.clock()
                self.record_snapshot(index, job.get("queue", {}))
                if job.get("job"):
                    self.metrics.observe("queue_wait_seconds", job.get("queue_wait_seconds"))
                    self.processor.process(gateway, job)
                    return True
            except WorkError:
                self.metrics.add("queue_poll_failures_total", 1)
        return False

    def refresh_queues(self):
        for index, gateway in enumerate(self.gateways):
            try:
                status = gateway.call("queue_status", {})
                self.last_success = self.clock()
                self.record_snapshot(index, status.get("queue", {}))
            except WorkError:
                self.metrics.add("queue_poll_failures_total", 1)
        with self.observation_lock:
            oldest = min(self.snapshot_times.get(i, self.started) for i in range(len(self.gateways)))
        self.metrics.set("queue_observation_age_seconds", max(0, self.clock() - oldest))

    def record_snapshot(self, index, queue):
        if not isinstance(queue, dict):
            return
        clean = {}
        for name in [
            "jobs",
            "audio_seconds",
            "oldest_age_seconds",
            "stalled_jobs",
            "incoming_audio_seconds_per_second",
            "completed_audio_seconds_per_second",
        ]:
            value = queue.get(name, 0)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
            ):
                return
            clean[name] = value
        with self.observation_lock:
            self.snapshots[index] = clean
            self.snapshot_times[index] = self.clock()
            self.metrics.set("observed_sites", len(self.snapshots))
            for metric in [
                "stalled_jobs",
                "incoming_audio_seconds_per_second",
                "completed_audio_seconds_per_second",
            ]:
                self.metrics.set(metric, sum(q[metric] for q in self.snapshots.values()))
            self.metrics.set("queued_jobs", sum(q["jobs"] for q in self.snapshots.values()))
            self.metrics.set("queued_audio_seconds", sum(q["audio_seconds"] for q in self.snapshots.values()))
            self.metrics.set(
                "oldest_queued_age_seconds",
                max(
                    (q["oldest_age_seconds"] for q in self.snapshots.values()),
                    default=0,
                ),
            )
