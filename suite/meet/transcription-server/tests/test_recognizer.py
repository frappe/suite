"""Regression signals measured on the pinned model, FLEURS and seeded noise."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from protocol import WorkError
from recognizer import TrelisRecognizer, repetition_fraction, segment_decision


class SegmentDecisionTests(unittest.TestCase):
    def test_confident_noise_repetition_is_not_speech(self):
        text = "ತರಷ್ತ ಇಲ್ಲಿ ಇಲ್ಲಿ ಇಲ್ಲಿ ಇಲ್ಲಿ"
        self.assertAlmostEqual(repetition_fraction(text), 0.8)
        self.assertEqual(
            segment_decision(1.14136e-5, -0.348868, 1.51923, repetition_fraction(text)), (False, "repetition")
        )

    def test_white_noise_and_click_hallucinations_are_rejected(self):
        for signals in [(0.0025925, -1.64450, 0.130435), (1.65457e-7, -2.22363, 0.130435)]:
            with self.subTest(signals=signals):
                self.assertEqual(segment_decision(*signals), (False, "low_probability"))

    def test_english_and_compressible_devanagari_speech_survive(self):
        for signals in [(7.42343e-5, -0.115770, 1.03774), (0.000165822, -0.0186703, 2.29333)]:
            with self.subTest(signals=signals):
                self.assertEqual(segment_decision(*signals), (True, "keep"))

    def test_ordinary_repeated_words_do_not_make_a_repeated_phrase(self):
        self.assertEqual(repetition_fraction("the channel and the bridge and the road"), 0)
        self.assertEqual(repetition_fraction("no no no, use the other channel"), 0)


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
