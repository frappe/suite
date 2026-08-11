# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import copy
import json
import subprocess
from pathlib import Path
from unittest.mock import Mock, patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.meet.recording.ingest import _validate_media


class IntegrationTestRecordingMediaValidation(IntegrationTestCase):
    def test_valid_recording_media_profile(self):
        with self._probe(self._valid_media()) as run:
            self.assertEqual(_validate_media(Path("recording.mp4")), {"duration_ms": 60000})
        self.assertEqual(run.call_count, 2)

    def test_invalid_media_profile_matrix(self):
        mutations = {
            "extra-stream": lambda media: media["streams"].append({"codec_type": "subtitle"}),
            "video-codec": lambda media: media["streams"][0].update(codec_name="vp9"),
            "profile": lambda media: media["streams"][0].update(profile="Main"),
            "pixel-format": lambda media: media["streams"][0].update(pix_fmt="yuv444p"),
            "resolution": lambda media: media["streams"][0].update(width=1280),
            "frame-rate": lambda media: media["streams"][0].update(avg_frame_rate="24/1"),
            "audio-codec": lambda media: media["streams"][1].update(codec_name="opus"),
            "sample-rate": lambda media: media["streams"][1].update(sample_rate="44100"),
            "channels": lambda media: media["streams"][1].update(channels=1),
            "negative-start": lambda media: media["streams"][0].update(start_time="-0.1"),
            "start-skew": lambda media: media["streams"][1].update(start_time="0.2"),
            "bad-rate": lambda media: media["streams"][0].update(avg_frame_rate="invalid"),
            "zero-duration": lambda media: media["format"].update(duration="0"),
            "bad-duration": lambda media: media["format"].update(duration="invalid"),
            "nan-duration": lambda media: media["format"].update(duration="nan"),
            "infinite-duration": lambda media: media["format"].update(duration="inf"),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                media = copy.deepcopy(self._valid_media())
                mutate(media)
                with self._probe(media), self.assertRaises(frappe.ValidationError):
                    _validate_media(Path("recording.mp4"))

    def test_probe_and_decode_failures_are_validation_errors(self):
        failures = (
            subprocess.TimeoutExpired("ffprobe", 120),
            subprocess.CalledProcessError(1, "ffprobe"),
            OSError("ffprobe unavailable"),
        )
        for error in failures:
            with (
                self.subTest(error=type(error).__name__),
                patch("suite.meet.recording.ingest.subprocess.run", side_effect=error),
                self.assertRaises(frappe.ValidationError),
            ):
                _validate_media(Path("recording.mp4"))

        for output in ("not-json", json.dumps({"streams": "invalid"}), "x" * (1024 * 1024 + 1)):
            with (
                self.subTest(output=output[:20]),
                patch("suite.meet.recording.ingest.subprocess.run", return_value=Mock(stdout=output)),
                self.assertRaises(frappe.ValidationError),
            ):
                _validate_media(Path("recording.mp4"))

        probe = Mock(stdout=json.dumps(self._valid_media()))
        with (
            patch(
                "suite.meet.recording.ingest.subprocess.run",
                side_effect=[probe, subprocess.CalledProcessError(1, "ffmpeg")],
            ),
            self.assertRaises(frappe.ValidationError),
        ):
            _validate_media(Path("recording.mp4"))

    def _probe(self, media: dict):
        return patch(
            "suite.meet.recording.ingest.subprocess.run",
            side_effect=[Mock(stdout=json.dumps(media)), Mock()],
        )

    def _valid_media(self) -> dict:
        return {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "profile": "High",
                    "pix_fmt": "yuv420p",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "30/1",
                    "start_time": "0.000",
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "profile": "LC",
                    "sample_rate": "48000",
                    "channels": 2,
                    "start_time": "0.000",
                },
            ],
            "format": {"duration": "60.000"},
        }
