import copy
import hashlib
import json
import runpy
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics import Metrics
from protocol import CONFIGURATION, MODEL, REVISION, Source, WorkError, make_hints, sources, validate_model
from worker import FairScheduler, Lease, Processor


def fixture(source_id="source-1", start=0, data=None):
    data = data if data is not None else b"\x01\x00" * 24000
    return {
        "source_id": source_id,
        "speaker_id": "participant-1",
        "speaker_name": "Asha",
        "start_ms": start,
        "end_ms": start + len(data) / 48,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "sample_rate": 24000,
        "url": "https://recorder.example/v1/transcriptions/capture-1/segments/" + source_id,
        "authorization": "Bearer source-capability",
    }, data


def job_for(items):
    return {
        "job": "job-1",
        "capture": "capture-1",
        "lease_token": "lease-1",
        "model": {
            "identifier": MODEL,
            "revision": REVISION,
            "precision": "float16",
            "configuration": copy.deepcopy(CONFIGURATION),
        },
        "hints": make_hints("", []),
        "manifest": {"segments": [item for item, _ in items], "gaps": []},
    }


class Gateway:
    def __init__(self, job, items):
        self.job = copy.deepcopy(job)
        self.audio = {item["source_id"]: data for item, data in items}
        self.calls = []
        self.downloads = []
        self.source_error = None

    def call(self, operation, payload):
        self.calls.append((operation, copy.deepcopy(payload)))
        if operation == "heartbeat":
            return {"manifest": copy.deepcopy(self.job["manifest"])}
        if operation == "complete":
            return {"status": "Ready", "capture_end_to_ready_seconds": 42}
        return {"status": "Queued"}

    def source(self, source, authorized):
        self.downloads.append(source.source_id)
        if self.source_error and source.source_id == "source-2":
            raise self.source_error
        assert Source.parse(authorized) == source
        data = self.audio[source.source_id]
        source.check_audio(data)
        return data


class Recognizer:
    def __init__(self):
        self.calls = []

    def transcribe(self, data, rate, **kwargs):
        self.calls.append((data, rate))
        return "The total is twenty rupees."


class ProcessingTests(unittest.TestCase):
    def test_recognition_metadata_is_immutable_and_does_not_leak_between_jobs(self):
        seen = []

        class MutatingRecognizer:
            def transcribe(self, data, rate, *, hints, speaker_name):
                seen.append(copy.deepcopy(hints))
                hints["participant_names"].append("Must not leak")
                return "Speech"

        processor = Processor(MutatingRecognizer(), Metrics(), threading.Event())
        for title, name in [("Atlas review", "Anita"), ("Payroll", "Rohan")]:
            items = [fixture(), fixture("source-2", start=2000)]
            job = job_for(items)
            job["hints"] = make_hints(title, [name])
            processor.process(Gateway(job, items), job)
            self.assertEqual(job["hints"]["participant_names"], [name])
        self.assertEqual([h["participant_names"] for h in seen], [["Anita"], ["Anita"], ["Rohan"], ["Rohan"]])

    def test_missing_or_unknown_hint_version_fails_before_source_access(self):
        for hints in [None, {**make_hints("", []), "vocabulary_version": "future-version"}]:
            items = [fixture()]
            job = {**job_for(items), "hints": hints}
            gateway = Gateway(job, items)
            self.assertEqual(
                Processor(Recognizer(), Metrics(), threading.Event()).process(gateway, job),
                "invalid_recognition_hints",
            )
            self.assertEqual(gateway.downloads, [])

    def test_new_backend_job_contract_is_supported_without_model_migration(self):
        backend = Path(__file__).resolve().parents[2] / "transcription" / "protocol.py"
        model = runpy.run_path(str(backend))["MODEL"]
        self.assertEqual(model["identifier"], "Trelis/whisper-hinglish-preview")
        self.assertEqual(model["revision"], "eab1188fd2d0e91f2584229b32b3bfe1901c896c")
        self.assertEqual(model["configuration"]["language"], "auto")
        self.assertEqual(model["configuration"]["task"], "transcribe")
        self.assertIsNone(validate_model(model))

    def test_bad_first_source_preserves_later_healthy_speech(self):
        items = [fixture("source-2"), fixture("source-3", start=2000)]
        job = job_for(items)
        gateway, recognizer = Gateway(job, items), Recognizer()
        gateway.source_error = WorkError("source_integrity_failed")
        result = Processor(recognizer, Metrics(), threading.Event()).process(gateway, job)
        self.assertEqual(result, "source_integrity_failed")
        self.assertEqual(gateway.downloads, ["source-2", "source-3"])
        failed = next(body for op, body in gateway.calls if op == "fail")
        self.assertEqual(failed["processed_source_ids"], ["source-3"])
        self.assertFalse(failed["transient"])
        self.assertEqual(failed["segments"][0]["text"], "The total is twenty rupees.")

    def test_transient_middle_source_does_not_block_later_speech_or_duplicate_retry(self):
        items = [fixture(), fixture("source-2", start=2000), fixture("source-3", start=4000)]
        job = job_for(items)
        gateway, recognizer = Gateway(job, items), Recognizer()
        gateway.source_error = WorkError("transport_failed", transient=True)
        processor = Processor(recognizer, Metrics(), threading.Event())
        processor.process(gateway, job)
        failed = next(body for op, body in gateway.calls if op == "fail")
        self.assertEqual(failed["processed_source_ids"], ["source-1", "source-3"])
        self.assertTrue(failed["transient"])
        resumed = {**job, "completed_segments": failed["segments"]}
        retry = Gateway(resumed, items)
        processor.process(retry, resumed)
        self.assertEqual(retry.downloads, ["source-2"])
        self.assertEqual(len(recognizer.calls), 3)

    def test_source_authorization_rejection_aborts_before_later_sources(self):
        items = [fixture("source-2"), fixture("source-3", start=2000)]
        job = job_for(items)
        gateway = Gateway(job, items)
        gateway.source_error = WorkError("authorization_or_lease_rejected")
        Processor(Recognizer(), Metrics(), threading.Event()).process(gateway, job)
        self.assertEqual(gateway.downloads, ["source-2"])
        self.assertFalse(any(op in ("fail", "complete") for op, _ in gateway.calls))

    def test_complete_preserves_speaker_timeline_and_gaps(self):
        items = [fixture()]
        job = job_for(items)
        job["manifest"]["gaps"] = [{"start_ms": 1000, "end_ms": 2000, "reason": "capture_interrupted"}]
        gateway, recognizer = Gateway(job, items), Recognizer()
        metrics = Metrics()
        Processor(recognizer, metrics, threading.Event()).process(gateway, job)
        final = next(payload for operation, payload in gateway.calls if operation == "complete")
        self.assertEqual(
            final["segments"],
            [
                {
                    "source_id": "source-1",
                    "speaker_id": "participant-1",
                    "speaker_name": "Asha",
                    "start_ms": 0,
                    "end_ms": 1000,
                    "text": "The total is twenty rupees.",
                }
            ],
        )
        self.assertEqual(final["gaps"], [{"start_ms": 1000, "end_ms": 2000, "reason": "capture_interrupted"}])
        self.assertTrue(final["partial"])
        self.assertEqual(final["processed_source_ids"], ["source-1"])
        self.assertEqual(len(recognizer.calls), 1)
        self.assertEqual(metrics.values["active_jobs"], 0)
        self.assertEqual(metrics.histograms["capture_end_to_ready_seconds"]["sum"], 42)

    def test_digital_silence_is_completed_without_invented_text(self):
        items = [fixture(data=b"\x00" * 48000)]
        job = job_for(items)
        gateway, recognizer = Gateway(job, items), Recognizer()
        Processor(recognizer, Metrics(), threading.Event()).process(gateway, job)
        final = next(value for op, value in gateway.calls if op == "complete")
        self.assertEqual(final["segments"][0]["text"], "")
        self.assertEqual(final["processed_source_ids"], ["source-1"])
        self.assertEqual(recognizer.calls, [])

    def test_transient_download_failure_checkpoints_success_and_retry_skips_it(self):
        items = [fixture(), fixture("source-2", start=2000)]
        job = job_for(items)
        gateway, recognizer = Gateway(job, items), Recognizer()
        gateway.source_error = WorkError("transport_failed", transient=True)
        processor = Processor(recognizer, Metrics(), threading.Event())
        processor.process(gateway, job)
        failed = next(value for op, value in gateway.calls if op == "fail")
        self.assertTrue(failed["transient"])
        self.assertEqual(failed["processed_source_ids"], ["source-1"])
        self.assertFalse(any(op == "complete" for op, _ in gateway.calls))
        resumed = copy.deepcopy(job)
        resumed["completed_segments"] = failed["segments"]
        second_gateway = Gateway(resumed, items)
        processor.process(second_gateway, resumed)
        self.assertEqual(second_gateway.downloads, ["source-2"])
        self.assertEqual(len(recognizer.calls), 2)
        final = next(value for op, value in second_gateway.calls if op == "complete")
        self.assertEqual(final["processed_source_ids"], ["source-1", "source-2"])

    def test_lease_rejection_never_generates_or_acknowledges(self):
        items = [fixture()]
        job, recognizer = job_for(items), Recognizer()
        gateway = Gateway(job, items)
        gateway.call = lambda *_: (_ for _ in ()).throw(WorkError("authorization_or_lease_rejected"))
        result = Processor(recognizer, Metrics(), threading.Event()).process(gateway, job)
        self.assertEqual(result, "authorization_or_lease_rejected")
        self.assertEqual(recognizer.calls, [])
        self.assertEqual(gateway.downloads, [])

    def test_shutdown_preserves_queue_work_without_running_inference(self):
        items = [fixture()]
        job, stop, recognizer = job_for(items), threading.Event(), Recognizer()
        stop.set()
        gateway = Gateway(job, items)
        Processor(recognizer, Metrics(), stop).process(gateway, job)
        self.assertEqual(recognizer.calls, [])
        failed = next(value for op, value in gateway.calls if op == "fail")
        self.assertEqual(failed["code"], "worker_shutdown")
        self.assertTrue(failed["transient"])

    def test_model_change_is_rejected_before_source_access(self):
        items = [fixture()]
        job = job_for(items)
        job["model"]["revision"] = "different-model"
        gateway, recognizer = Gateway(job, items), Recognizer()
        Processor(recognizer, Metrics(), threading.Event()).process(gateway, job)
        self.assertEqual(gateway.downloads, [])
        self.assertEqual(recognizer.calls, [])
        self.assertEqual(gateway.calls[0][1]["code"], "unsupported_model_configuration")

    def test_decoding_changes_and_legacy_jobs_cannot_reuse_checkpoints(self):
        items = [fixture()]
        configurations = [
            {"language": "en", "sample_rate": 24000},
            {**CONFIGURATION, "task": "translate"},
            {**CONFIGURATION, "mixedcode_token_id": 0},
            {**CONFIGURATION, "condition_on_prev_tokens": True},
            {**CONFIGURATION, "max_new_tokens": 100},
            None,
        ]
        for configuration in configurations:
            with self.subTest(configuration=configuration):
                job = job_for(items)
                job["model"]["configuration"] = configuration
                job["completed_segments"] = [Source.parse(items[0][0]).result("Earlier result")]
                gateway, recognizer = Gateway(job, items), Recognizer()
                result = Processor(recognizer, Metrics(), threading.Event()).process(gateway, job)
                self.assertEqual(result, "unsupported_model_configuration")
                self.assertEqual(gateway.downloads, [])
                self.assertEqual(recognizer.calls, [])

    def test_mixed_language_text_survives_a_retry_with_original_speaker_and_time(self):
        items = [fixture(), fixture("source-2", start=2000)]
        job = job_for(items)
        recognizer = Recognizer()
        recognizer.transcribe = lambda *_, **kwargs: "कल Atlas signup की pricing confirm करेंगे।"
        gateway = Gateway(job, items)
        gateway.source_error = WorkError("transport_failed", transient=True)
        processor = Processor(recognizer, Metrics(), threading.Event())
        processor.process(gateway, job)
        checkpoint = next(body for op, body in gateway.calls if op == "fail")
        resumed = {**job, "completed_segments": checkpoint["segments"]}
        retry = Gateway(resumed, items)
        processor.process(retry, resumed)
        completed = next(body for op, body in retry.calls if op == "complete")
        self.assertEqual(retry.downloads, ["source-2"])
        self.assertEqual(
            [s["text"] for s in completed["segments"]],
            [
                "कल Atlas signup की pricing confirm करेंगे।",
                "कल Atlas signup की pricing confirm करेंगे।",
            ],
        )
        self.assertEqual(
            [(s["speaker_name"], s["start_ms"], s["end_ms"]) for s in completed["segments"]],
            [
                ("Asha", 0, 1000),
                ("Asha", 2000, 3000),
            ],
        )

    def test_refresh_cannot_change_source_identity_or_timing(self):
        items = [fixture()]
        job, gateway = job_for(items), Gateway(job_for(items), items)
        lease = Lease(gateway, job)
        gateway.job["manifest"]["segments"][0]["speaker_id"] = "other-participant"
        with self.assertRaisesRegex(WorkError, "source_manifest_changed"):
            lease.heartbeat()

    def test_audio_hash_or_duration_mismatch_is_rejected(self):
        source, data = fixture()
        with self.assertRaisesRegex(WorkError, "source_integrity_failed"):
            Source.parse(source).check_audio(data[:-2])
        source["end_ms"] = 2000
        with self.assertRaisesRegex(WorkError, "invalid_manifest"):
            Source.parse(source)

    def test_duplicate_sources_are_not_silently_overwritten(self):
        source, _ = fixture()
        with self.assertRaisesRegex(WorkError, "invalid_manifest"):
            sources({"segments": [source, source]})


class SchedulingTests(unittest.TestCase):
    def test_large_site_backlog_does_not_starve_another_site(self):
        processed = []

        class Queue:
            def __init__(self, name):
                self.name = name

            def call(self, operation, payload):
                return {
                    "job": self.name,
                    "queue": {"jobs": 1000, "audio_seconds": 3000, "oldest_age_seconds": 80},
                }

        class Processor:
            def process(self, gateway, job):
                processed.append(job["job"])

        scheduler = FairScheduler([Queue("site-a"), Queue("site-b")], Processor(), Metrics())
        for _ in range(4):
            scheduler.step()
        self.assertEqual(processed, ["site-a", "site-b", "site-a", "site-b"])

    def test_unavailable_site_does_not_block_other_sites(self):
        calls = []

        class Broken:
            def call(self, *_):
                raise WorkError("transport_failed", transient=True)

        class Healthy:
            def call(self, *_):
                return {"job": "ready-job"}

        class Processor:
            def process(self, gateway, job):
                calls.append(job["job"])

        metrics = Metrics()
        FairScheduler([Broken(), Healthy()], Processor(), metrics).step()
        self.assertEqual(calls, ["ready-job"])
        self.assertEqual(metrics.values["queue_poll_failures_total"], 1)

    def test_observation_refreshes_backlog_without_claiming_a_job(self):
        calls = []

        class Queue:
            def call(self, operation, payload):
                calls.append(operation)
                return {"queue": {"jobs": 7, "audio_seconds": 1200, "oldest_age_seconds": 400}}

        metrics = Metrics()
        scheduler = FairScheduler([Queue()], None, metrics)
        scheduler.refresh_queues()
        self.assertEqual(calls, ["queue_status"])
        self.assertEqual(metrics.values["queued_jobs"], 7)
        self.assertEqual(metrics.values["queued_audio_seconds"], 1200)
        self.assertEqual(metrics.values["oldest_queued_age_seconds"], 400)
        self.assertNotIn("source-1", metrics.render())


if __name__ == "__main__":
    unittest.main()
