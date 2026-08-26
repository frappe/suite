import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from protocol import (
    REALTIME_SAMPLE_RATE,
    clean_transcript,
    openai_sse_event,
    realtime_error,
    realtime_session,
    transcript_delta,
    validate_session_update,
)


class ProtocolTest(unittest.TestCase):
    def setUp(self):
        self.update = {
            "type": "session.update",
            "session": {
                "type": "transcription",
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": REALTIME_SAMPLE_RATE},
                        "transcription": {"model": "nemotron", "language": "en-US"},
                        "turn_detection": None,
                    }
                },
            },
        }

    def test_validates_realtime_transcription_session(self):
        config, error = validate_session_update(self.update, {"nemotron"}, "nemotron", "en-US")
        self.assertIsNone(error)
        self.assertEqual(config, {"model": "nemotron", "language": "en-US"})

        invalid = self.update | {
            "session": self.update["session"]
            | {
                "audio": {
                    "input": self.update["session"]["audio"]["input"]
                    | {"format": {"type": "audio/pcm", "rate": 16000}}
                }
            }
        }
        _, error = validate_session_update(invalid, {"nemotron"}, "nemotron", "en-US")
        self.assertEqual(error, "Only 24000 Hz audio/pcm is supported")

        config, error = validate_session_update(
            {"type": "session.update", "session": {"type": "transcription"}},
            {"nemotron"},
            "nemotron",
            "en-US",
        )
        self.assertIsNone(error)
        self.assertEqual(config, {"model": "nemotron", "language": "en-US"})

    def test_builds_realtime_session_and_error_events(self):
        session = realtime_session("sess_1", "nemotron", "en-US")
        self.assertEqual(session["object"], "realtime.transcription_session")
        self.assertEqual(session["audio"]["input"]["format"]["rate"], 24000)
        self.assertEqual(session["audio"]["input"]["transcription"]["model"], "nemotron")
        error = realtime_error("bad event", "client_event_1")
        self.assertEqual(error["type"], "error")
        self.assertEqual(error["error"]["event_id"], "client_event_1")

    def test_cleans_language_tags_and_frames_openai_events(self):
        self.assertEqual(clean_transcript(" <EN-us>  Hello   world "), "Hello world")
        self.assertEqual(
            openai_sse_event({"type": "transcript.text.delta", "delta": "Hello"}),
            'data: {"type": "transcript.text.delta", "delta": "Hello"}\n\n',
        )

    def test_transcript_delta_handles_growth_and_hypothesis_rewrites(self):
        self.assertEqual(transcript_delta("Hello", "Hello world"), " world")
        self.assertIsNone(transcript_delta("Hello word", "Hello world"))
        self.assertIsNone(transcript_delta("Hello", "Hello"))


if __name__ == "__main__":
    unittest.main()
