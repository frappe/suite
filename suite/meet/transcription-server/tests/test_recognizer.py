import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from protocol import WorkError
from recognizer import TrelisRecognizer


class InputTests(unittest.TestCase):
    def test_invalid_or_overlong_audio_never_enters_inference(self):
        # No model/dependencies: these inputs must fail before feature extraction.
        recognizer = TrelisRecognizer.__new__(TrelisRecognizer)
        for pcm, rate in [
            (b"", 24000),
            (b"\1", 24000),
            (b"\1\0", 16000),
            (b"\1\0" * (30 * 24000 + 1), 24000),
        ]:
            with self.subTest(size=len(pcm), rate=rate):
                with self.assertRaisesRegex(WorkError, "unsupported_source_format"):
                    recognizer.transcribe(pcm, rate)

    def test_exact_digital_silence_does_not_require_model_output(self):
        recognizer = TrelisRecognizer.__new__(TrelisRecognizer)
        self.assertEqual(recognizer.transcribe(b"\0\0" * (30 * 24000), 24000), "")
