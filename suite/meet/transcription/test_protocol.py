import copy
import unittest

from suite.meet.transcription.protocol import render_transcript, validate_manifest, validate_results


class TestTranscriptionProtocol(unittest.TestCase):
    def setUp(self):
        self.source = {
            "source_id": "speech-1",
            "speaker_id": "participant-1",
            "speaker_name": "Anita",
            "start_ms": 1000,
            "end_ms": 3000,
            "size": 96000,
            "sha256": "a" * 64,
            "sample_rate": 24000,
        }
        self.manifest = {
            "capture": "capture-a",
            "site": "site-a",
            "room": "room-a",
            "segments": [self.source],
            "gaps": [],
        }

    def test_pcm_duration_and_speaker_work_are_validated_independently(self):
        result = validate_manifest(self.manifest, "capture-a", "site-a", "room-a", 100000)
        self.assertEqual(result["audio_seconds"], 2)
        self.assertEqual(result["source_bytes"], 96000)
        broken = copy.deepcopy(self.manifest)
        broken["segments"][0]["size"] = 48000
        with self.assertRaisesRegex(ValueError, "duration"):
            validate_manifest(broken, "capture-a", "site-a", "room-a", 100000)

    def test_cross_site_and_repeated_sources_rejected(self):
        with self.assertRaisesRegex(ValueError, "identity"):
            validate_manifest(self.manifest, "capture-a", "site-b", "room-a", 100000)
        self.manifest["segments"].append(copy.deepcopy(self.source))
        with self.assertRaisesRegex(ValueError, "identifier"):
            validate_manifest(self.manifest, "capture-a", "site-a", "room-a", 200000)

    def test_worker_cannot_reassign_speech_or_invent_sources(self):
        result = {
            k: self.source[k] for k in ("source_id", "speaker_id", "speaker_name", "start_ms", "end_ms")
        }
        result["text"] = "The amount is twenty rupees."
        self.assertEqual(validate_results([result], self.manifest), [result])
        for field, value in [("speaker_name", "Other"), ("start_ms", 0), ("source_id", "other")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_results([{**result, field: value}], self.manifest)

    def test_partial_transcript_orders_overlapping_speakers_and_marks_gaps(self):
        segments = [
            {"start_ms": 3000, "end_ms": 5000, "speaker_name": "Vikram", "text": "Second speaker"},
            {"start_ms": 1000, "end_ms": 4000, "speaker_name": "Anita", "text": "First speaker"},
        ]
        text = render_transcript(
            segments, [{"start_ms": 6000, "end_ms": 7000, "reason": "source_interrupted"}], True
        )
        self.assertEqual(
            text,
            "Partial transcript — speech may be missing within the marked intervals.\n\n[00:00:01 - 00:00:04] Anita: First speaker\n[00:00:03 - 00:00:05] Vikram: Second speaker\n[00:00:06 - 00:00:07] [Possible missing audio: source interrupted]\n",
        )

    def test_conservative_restart_interval_keeps_recovered_speech(self):
        text = render_transcript(
            [{"start_ms": 1000, "end_ms": 2000, "speaker_name": "Anita", "text": "Recovered speech"}],
            [{"start_ms": 0, "end_ms": 110000, "reason": "service_restart"}],
            True,
        )
        self.assertIn("[00:00:00 - 00:01:50] [Possible missing audio: service restart]", text)
        self.assertIn("[00:00:01 - 00:00:02] Anita: Recovered speech", text)

    def test_silence_is_a_result_without_invented_speech(self):
        self.assertEqual(render_transcript([], [], False), "Transcript\n\n[No speech detected]\n")
        with self.assertRaises(ValueError):
            validate_results([{"source_id": "not-captured", "text": ""}], self.manifest)

    def test_original_languages_and_marks_survive_plain_text_rendering(self):
        self.assertEqual(
            render_transcript(
                [
                    {
                        "start_ms": 1000,
                        "end_ms": 3000,
                        "speaker_name": "Anita",
                        "text": "कल input/output की क़ीमत confirm करेंगे। हूँ, ठीक है।",
                    },
                ],
                [],
                False,
            ),
            "Transcript\n\n[00:00:01 - 00:00:03] Anita: कल input/output की क़ीमत confirm करेंगे। हूँ, ठीक है।\n",
        )


if __name__ == "__main__":
    unittest.main()
