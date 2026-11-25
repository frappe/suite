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


class EncoderReuseTests(unittest.TestCase):
    def test_speech_uses_one_encoder_pass_with_prompt_aware_scoring(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        try:
            import numpy as np
            import torch
        except ImportError:
            self.skipTest("Requires the worker's Torch and NumPy dependencies")

        from protocol import CONFIGURATION

        encoder = Mock(return_value=object())
        tokenizer = Mock()
        tokenizer.convert_ids_to_tokens.return_value = "<|en|>"
        tokenizer.convert_tokens_to_ids.side_effect = {
            "<|startoftranscript|>": 1,
            "<|transcribe|>": 3,
            "<|notimestamps|>": 4,
            "<|nospeech|>": 5,
        }.__getitem__
        tokenizer.get_prompt_ids.return_value = np.array([8, 9])
        tokenizer.decode.return_value = "Hello"
        prefix = [8, 9, 1, 2, CONFIGURATION["mixedcode_token_id"], 3, 4]
        features = torch.ones((1, 80, 3000))

        class Inputs(dict):
            __getattr__ = dict.__getitem__

            def to(self, *args, **kwargs):
                return self

        def encoded(kwargs):
            # Model entry points encode features if no cached output is supplied.
            return kwargs.get("encoder_outputs") or encoder(kwargs["input_features"])

        def detect_language(**kwargs):
            encoded(kwargs)
            return [2]

        def first_step(**kwargs):
            encoded(kwargs)
            self.assertEqual(kwargs["decoder_input_ids"].tolist(), [[8, 9, 1]])
            return SimpleNamespace(logits=torch.zeros((1, 3, 10)))

        def generate(**kwargs):
            encoded(kwargs)
            self.assertEqual(kwargs["decoder_input_ids"].tolist(), [prefix])
            self.assertEqual(kwargs["attention_mask"].tolist(), [[1]])
            scores = torch.zeros((1, 10))
            scores[0, 6] = 10
            return SimpleNamespace(sequences=torch.tensor([[*prefix, 6]]), scores=(scores,))

        model = Mock(side_effect=first_step)
        model.device, model.dtype = "cpu", torch.float32
        model.config = SimpleNamespace(max_target_positions=448)
        model.generation_config = SimpleNamespace(lang_to_id={"<|en|>": 2}, eos_token_id=6)
        model.get_encoder.return_value = encoder
        model.detect_language.side_effect = detect_language
        model.generate.side_effect = generate
        recognizer = TrelisRecognizer.__new__(TrelisRecognizer)
        recognizer.torch, recognizer.model, recognizer.metrics = torch, model, None
        recognizer.processor = Mock(
            return_value=Inputs(input_features=features, attention_mask=torch.ones((1, 1)))
        )
        recognizer.processor.tokenizer = tokenizer
        functional = SimpleNamespace(resample=lambda waveform, *_: waveform)
        with (
            patch.dict(
                sys.modules,
                {"torchaudio": SimpleNamespace(functional=functional), "torchaudio.functional": functional},
            ),
            patch("recognizer.hint_phrases", return_value=["Hello"]),
        ):
            self.assertEqual(recognizer.transcribe(b"\1\0" * 240, 24000), "Hello")
        self.assertEqual(encoder.call_count, 1)
        self.assertIs(encoder.call_args.args[0], features)
