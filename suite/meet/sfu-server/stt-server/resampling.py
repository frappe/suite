import numpy as np
import soxr


class StreamingResampler:
    """Stateful resampler that preserves filter history across audio chunks."""

    def __init__(self, input_rate: int, output_rate: int):
        self.stream = soxr.ResampleStream(input_rate, output_rate, 1, dtype="float32", quality="HQ")

    def process(self, audio: np.ndarray) -> np.ndarray:
        return self.stream.resample_chunk(np.asarray(audio, dtype=np.float32))

    def flush(self) -> np.ndarray:
        return self.stream.resample_chunk(np.empty(0, dtype=np.float32), last=True)
