"""Aggregate metrics only; site, job, capture and participant IDs are never labels."""

import math
import threading

DEFINITIONS = {
    "ready": ("gauge", "Worker model readiness"),
    "healthy": ("gauge", "Model ready and authenticated queue access is recent"),
    "active_jobs": ("gauge", "Jobs currently processing on this worker"),
    "configured_sites": ("gauge", "Number of configured source sites"),
    "observed_sites": ("gauge", "Sites with an observed queue snapshot"),
    "stalled_jobs": ("gauge", "Jobs with expired processing leases at last observation"),
    "incoming_audio_seconds_per_second": (
        "gauge",
        "Mean queued audio arrival rate over the site reporting window",
    ),
    "completed_audio_seconds_per_second": (
        "gauge",
        "Mean completed audio rate over the site reporting window",
    ),
    "retries_scheduled_total": ("counter", "Processing failures acknowledged for bounded retry"),
    "jobs_partial_total": ("counter", "Acknowledged usable partial results"),
    "jobs_terminal_failed_total": ("counter", "Acknowledged failures without a usable result"),
    "queued_jobs": ("gauge", "Queued jobs across configured sites at last successful observation"),
    "queued_audio_seconds": ("gauge", "Queued source audio duration across separate speaker tracks"),
    "oldest_queued_age_seconds": ("gauge", "Age of the oldest queued job at last successful observation"),
    "queue_poll_failures_total": ("counter", "Failed authenticated queue requests"),
    "jobs_completed_total": ("counter", "Successfully acknowledged transcription jobs"),
    "jobs_failed_total": ("counter", "Failed processing attempts including lease loss"),
    "segments_completed_total": ("counter", "Sources processed by this worker including silence"),
    "processed_audio_seconds_total": ("counter", "Actual source audio processed, including retry work"),
    "processing_seconds_total": (
        "counter",
        "Wall time spent on jobs including retrieval and protocol overhead",
    ),
    "gpu_allocated_bytes": ("gauge", "Current candidate Torch GPU allocation"),
    "gpu_reserved_bytes": ("gauge", "Current candidate Torch GPU reserved memory"),
    "resident_memory_peak_bytes": ("gauge", "Peak worker resident memory"),
    "queue_observation_age_seconds": (
        "gauge",
        "Time since the oldest configured site last returned queue status",
    ),
}
HISTOGRAMS = {
    "queue_wait_seconds": "Wait from capture completion until a job is claimed",
    "capture_end_to_ready_seconds": "Elapsed time from capture completion until a usable result is published",
    "job_processing_duration_seconds": "Wall processing duration per job attempt",
}
BUCKETS = (1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200, 14400, 86400)
PREFIX = "meet_transcription_"


class Metrics:
    def __init__(self):
        self.lock = threading.Lock()
        self.values = dict.fromkeys(DEFINITIONS, 0.0)
        self.histograms = {name: {"count": 0, "sum": 0, "buckets": [0] * len(BUCKETS)} for name in HISTOGRAMS}

    def set(self, name, value):
        if name not in DEFINITIONS or not math.isfinite(value) or value < 0:
            raise ValueError("Invalid aggregate metric")
        with self.lock:
            self.values[name] = value

    def add(self, name, value):
        if name not in DEFINITIONS or not math.isfinite(value) or value < 0:
            raise ValueError("Invalid aggregate metric")
        with self.lock:
            self.values[name] += value

    def observe(self, name, value):
        if (
            name not in HISTOGRAMS
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < 0
        ):
            return
        with self.lock:
            histogram = self.histograms[name]
            histogram["count"] += 1
            histogram["sum"] += value
            for index, bound in enumerate(BUCKETS):
                if value <= bound:
                    histogram["buckets"][index] += 1

    def render(self):
        with self.lock:
            lines = []
            for name, (kind, description) in DEFINITIONS.items():
                metric = PREFIX + name
                lines.extend(
                    [
                        f"# HELP {metric} {description}",
                        f"# TYPE {metric} {kind}",
                        f"{metric} {self.values[name]}",
                    ]
                )
            for name, description in HISTOGRAMS.items():
                metric, data = PREFIX + name, self.histograms[name]
                lines.extend([f"# HELP {metric} {description}", f"# TYPE {metric} histogram"])
                for bound, count in zip(BUCKETS, data["buckets"], strict=True):
                    lines.append(f'{metric}_bucket{{le="{bound}"}} {count}')
                lines.extend(
                    [
                        f'{metric}_bucket{{le="+Inf"}} {data["count"]}',
                        f"{metric}_count {data['count']}",
                        f"{metric}_sum {data['sum']}",
                    ]
                )
            return "\n".join(lines) + "\n"
