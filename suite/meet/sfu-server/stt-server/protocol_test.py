import unittest

from protocol import (
    REALTIME_SAMPLE_RATE,
    bearer_token_matches,
    clean_transcript,
    normalize_language,
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

    def test_rejects_malformed_nested_session_values(self):
        cases = (
            ([], "session.audio must be an object"),
            ({"input": []}, "session.audio.input must be an object"),
            ({"input": {"format": []}}, "session.audio.input.format must be an object"),
            ({"input": {"transcription": []}}, "session.audio.input.transcription must be an object"),
            ({"input": {"transcription": {"model": []}}}, "transcription.model must be a string"),
            ({"input": {"transcription": {"language": 1}}}, "transcription.language must be a string"),
            (
                {"input": {"transcription": {"languages": [1]}}},
                "transcription.languages must be an array of strings",
            ),
        )
        for audio, expected_error in cases:
            with self.subTest(error=expected_error):
                message = {
                    "type": "session.update",
                    "session": {"type": "transcription", "audio": audio},
                }
                config, error = validate_session_update(message, {"nemotron"}, "nemotron", "en-US")
                self.assertIsNone(config)
                self.assertEqual(error, expected_error)

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

    def test_normalizes_unsupported_english_locales(self):
        self.assertEqual(normalize_language("en-gb", "en-US"), "en-GB")
        self.assertEqual(normalize_language("en-AU", "en-US"), "en-US")
        self.assertEqual(normalize_language("en-IN", "en-US"), "en-US")
        self.assertEqual(normalize_language("hi-in", "en-US"), "hi-IN")

    def test_transcript_delta_handles_growth_and_hypothesis_rewrites(self):
        self.assertEqual(transcript_delta("Hello", "Hello world"), " world")
        self.assertIsNone(transcript_delta("Hello word", "Hello world"))
        self.assertIsNone(transcript_delta("Hello", "Hello"))

    def test_bearer_authentication_fails_closed(self):
        self.assertTrue(bearer_token_matches("Bearer secret", "secret"))
        self.assertTrue(bearer_token_matches("bearer secret", "secret"))
        self.assertFalse(bearer_token_matches(None, "secret"))
        self.assertFalse(bearer_token_matches("Bearer wrong", "secret"))
        self.assertFalse(bearer_token_matches("Bearer secret", None))


if __name__ == "__main__":
    unittest.main()
