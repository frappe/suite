"""GPU/runtime regression tests. Run in the STT image with cached model weights."""

import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

EXTERNAL_DEPENDENCIES = ("numpy", "soundfile", "soxr", "torch", "nemo")
missing_dependencies = [name for name in EXTERNAL_DEPENDENCIES if importlib.util.find_spec(name) is None]

if missing_dependencies:
    server = None
else:
    import numpy as np
    import server
    import soundfile as sf
    import soxr
    import torch
    from nemo.utils import logging


@unittest.skipIf(missing_dependencies, f"Missing STT dependencies: {', '.join(missing_dependencies)}")
class StreamingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        logging.set_verbosity(logging.ERROR)
        server.NEMOTRON_ATT_CONTEXT_SIZE = "56,6"
        server.NEMOTRON_FINAL_SILENCE_MS = 700
        server.load_model()

    def assert_features_match(self, audio, packet_samples=320):
        reference = server.CacheAwareStreamingAudioBuffer(server.model, online_normalization=False)
        reference.append_audio(audio)
        expected = [(f, n, reference.is_buffer_empty()) for f, n in reference]
        features = server.StreamingFeatureBuffer()
        actual = []
        for start in range(0, len(audio), packet_samples):
            features.append(audio[start : start + packet_samples])
            while (chunk := features.pop_chunk(final=False)) is not None:
                actual.append(chunk)
        while (chunk := features.pop_chunk(final=True)) is not None:
            actual.append(chunk)
        self.assertEqual(len(actual), len(expected))
        for (got, length, last), (want, want_length, want_last) in zip(actual, expected, strict=True):
            self.assertEqual(got.shape, want.shape)
            self.assertTrue(torch.equal(length, want_length))
            self.assertEqual(last, want_last)
            torch.testing.assert_close(got, want, atol=2e-5, rtol=1e-5)

    def test_first_chunk_and_centered_stft_match_reference(self):
        audio = np.random.default_rng(7).normal(0, 0.05, 32000).astype(np.float32)
        self.assert_features_match(audio)

    def test_short_and_exact_boundaries_at_supported_contexts(self):
        rng = np.random.default_rng(11)
        try:
            for right_context in (0, 1, 3, 6, 13):
                server.model.encoder.set_default_att_context_size([56, right_context])
                first, steady = server.model.encoder.streaming_cfg.chunk_size
                lengths = (
                    1,
                    159,
                    160,
                    257,
                    first * 160 - 1,
                    first * 160,
                    first * 160 + 1,
                    first * 160 + 256,
                    (first + steady) * 160 - 1,
                    (first + steady) * 160,
                    (first + steady) * 160 + 1,
                )
                for count in lengths:
                    with self.subTest(context=right_context, samples=count):
                        self.assert_features_match(
                            rng.normal(0, 0.03, count).astype(np.float32), packet_samples=317
                        )
        finally:
            server.model.encoder.set_default_att_context_size([56, 6])

    def test_raw_feature_storage_is_bounded_for_long_input(self):
        features = server.StreamingFeatureBuffer()
        block = np.zeros(320, dtype=np.float32)
        for _ in range(6000):  # Two minutes, no whole-prefix feature recomputation.
            features.append(block)
            while features.pop_chunk(final=False) is not None:
                pass
            self.assertLess(features.audio.size, 20000)
            self.assertLessEqual(features.history.shape[-1], 9)

    def test_normal_finalization_does_not_redecode_and_resets(self):
        root = Path(os.getenv("STT_TEST_CORPUS", "/eval/mic-ab"))
        if not (root / "manifest.jsonl").exists():
            self.skipTest("Set STT_TEST_CORPUS to the persistent microphone corpus")
        row = json.loads((root / "manifest.jsonl").read_text().splitlines()[0])
        audio, rate = sf.read(root / row["audio"], dtype="float32")
        self.assertEqual(rate, 24000)
        pcm = (audio * 32767).astype("<i2").tobytes()
        # Use the exact same PCM conversion and stream resampler for the oracle.
        resampler = server.StreamingResampler(24000, 16000)
        parts = [
            resampler.process(server.pcm16le_to_float32(pcm[i : i + 960])) for i in range(0, len(pcm), 960)
        ]
        parts.append(resampler.flush())
        expected = server.FinalDecoder().transcribe(np.pad(np.concatenate(parts), (0, 11200)))
        session = server.RealtimeTranscriptionSession("en-US")
        try:
            for _ in range(2):
                with patch.object(
                    server.FinalDecoder, "transcribe", side_effect=AssertionError("Unexpected full re-decode")
                ):
                    for i in range(0, len(pcm), 960):
                        session.append_and_decode(pcm[i : i + 960])
                    self.assertEqual(session.finalize(), expected)
                self.assertFalse(session.has_audio)
                self.assertFalse(session.last_final_used_fallback)
            self.assertEqual(session.finalize(), "")
        finally:
            session.close()

    def test_failure_fallback_and_clear_release_audio(self):
        session = server.RealtimeTranscriptionSession("en-US")
        try:
            with patch.object(
                session.incremental_decoder, "feed", side_effect=RuntimeError("injected failure")
            ):
                session.append_and_decode(np.zeros(24000, dtype="<i2").tobytes())
            with patch.object(server.FinalDecoder, "transcribe", return_value="fallback") as fallback:
                self.assertEqual(session.finalize(), "fallback")
                self.assertEqual(fallback.call_count, 1)
            self.assertTrue(session.last_final_used_fallback)
            self.assertFalse(session.incremental_failed)
            with patch.object(
                server.FinalDecoder, "transcribe", side_effect=AssertionError("Fallback remained latched")
            ):
                session.append_and_decode(np.zeros(24000, dtype="<i2").tobytes())
                session.finalize()
            self.assertFalse(session.last_final_used_fallback)
            session.append_and_decode(np.zeros(24000, dtype="<i2").tobytes())
            old_file = session.fallback_audio
            session.clear()
            self.assertTrue(old_file.closed)
            self.assertFalse(session.has_audio)
        finally:
            session.close()

    def test_final_flush_failure_falls_back(self):
        session = server.RealtimeTranscriptionSession("en-US")
        try:
            session.append_and_decode(np.zeros(24000, dtype="<i2").tobytes())
            with patch.object(
                session.incremental_decoder, "flush", side_effect=RuntimeError("injected final failure")
            ):
                with patch.object(server.FinalDecoder, "transcribe", return_value="recovered"):
                    self.assertEqual(session.finalize(), "recovered")
            self.assertTrue(session.last_final_used_fallback)
            self.assertFalse(session.has_audio)
        finally:
            session.close()

    def test_decoder_flush_boundaries_and_large_packets(self):
        root = Path(os.getenv("STT_TEST_CORPUS", "/eval/mic-ab"))
        if not (root / "manifest.jsonl").exists():
            self.skipTest("Set STT_TEST_CORPUS to the persistent microphone corpus")
        row = json.loads((root / "manifest.jsonl").read_text().splitlines()[0])
        audio, rate = sf.read(root / row["audio"], dtype="float32")
        audio = soxr.resample(audio, rate, 16000)
        for count in (0, 1, 7840, 8960, 17920, 32000, len(audio)):
            with self.subTest(samples=count):
                decoder = server.IncrementalDecoder()
                expected = server.FinalDecoder().transcribe(audio[:count])
                peak = 0
                append = decoder.features.append

                def track(samples):
                    nonlocal peak
                    append(samples)
                    peak = max(peak, decoder.features.audio.size)

                with patch.object(decoder.features, "append", side_effect=track):
                    decoder.feed(audio[:count])
                self.assertEqual(decoder.flush(), expected)
                self.assertLess(peak, 20000)

    def test_long_utterance_matches_reference_without_reading_fallback_audio(self):
        root = Path(os.getenv("STT_TEST_CORPUS", "/eval/mic-ab"))
        if not (root / "manifest.jsonl").exists():
            self.skipTest("Set STT_TEST_CORPUS to the persistent microphone corpus")
        row = json.loads((root / "manifest.jsonl").read_text().splitlines()[0])
        audio, rate = sf.read(root / row["audio"], dtype="float32")
        self.assertEqual(rate, 24000)
        pcm = (np.tile(audio, 6) * 32767).astype("<i2").tobytes()
        resampler = server.StreamingResampler(24000, 16000)
        parts = [
            resampler.process(server.pcm16le_to_float32(pcm[i : i + 4800])) for i in range(0, len(pcm), 4800)
        ]
        parts.append(resampler.flush())
        expected = server.FinalDecoder().transcribe(np.pad(np.concatenate(parts), (0, 11200)))
        session = server.RealtimeTranscriptionSession("en-US")
        try:
            for i in range(0, len(pcm), 4800):
                session.append_and_decode(pcm[i : i + 4800])
                self.assertLess(session.incremental_decoder.features.audio.size, 20000)
            captured = session.fallback_audio
            with patch.object(
                captured, "read", side_effect=AssertionError("Normal finalize read fallback audio")
            ):
                self.assertEqual(session.finalize(), expected)
            self.assertTrue(captured.closed)
            self.assertFalse(session.last_final_used_fallback)
        finally:
            session.close()


if __name__ == "__main__":
    unittest.main()
