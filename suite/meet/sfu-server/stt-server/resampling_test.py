import sys
import unittest
from pathlib import Path

import numpy as np
import soxr

sys.path.insert(0, str(Path(__file__).parent))

from resampling import StreamingResampler


class StreamingResamplerTest(unittest.TestCase):
    def test_chunked_output_matches_continuous_resampling(self):
        sample_count = int(2.35 * 24000)
        time = np.arange(sample_count, dtype=np.float32) / 24000
        audio = (0.4 * np.sin(2 * np.pi * (180 + 1200 * time) * time)).astype(np.float32)
        expected = soxr.resample(audio, 24000, 16000, quality="HQ")

        resampler = StreamingResampler(24000, 16000)
        chunks = [resampler.process(audio[offset : offset + 2400]) for offset in range(0, len(audio), 2400)]
        chunks.append(resampler.flush())
        actual = np.concatenate(chunks)

        self.assertEqual(actual.shape, expected.shape)
        np.testing.assert_allclose(actual, expected, rtol=1e-5, atol=1e-5)


if __name__ == "__main__":
    unittest.main()
