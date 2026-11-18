"""Optional real-GPU contract smoke using an authorized human-reference fixture.

python tests/gpu_smoke.py --audio /private/speech.wav --reference-file /private/reference.txt --cache /models
Only aggregate scores/resources are printed; no audio, reference or prediction is logged.
"""

import argparse
import copy
import hashlib
import importlib.metadata
import json
import sys
import threading
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics import Metrics
from protocol import CONFIGURATION, MODEL, REVISION, make_hints
from recognizer import TrelisRecognizer
from worker import Processor


def words(text):
    return "".join(
        " " if unicodedata.category(c)[0] in "PS" else c
        for c in unicodedata.normalize("NFC", text).casefold()
    ).split()


def distance(expected, actual):
    matrix = [[0] * (len(actual) + 1) for _ in range(len(expected) + 1)]
    for index in range(len(expected) + 1):
        matrix[index][0] = index
    for index in range(len(actual) + 1):
        matrix[0][index] = index
    for i, left in enumerate(expected, 1):
        for j, right in enumerate(actual, 1):
            matrix[i][j] = min(
                matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + (left != right)
            )
    return matrix[-1][-1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--reference-file", required=True)
    parser.add_argument("--cache", required=True)
    args = parser.parse_args()
    import soundfile
    import torch
    import torchaudio.functional

    audio, rate = soundfile.read(args.audio, dtype="float32")
    assert audio.ndim == 1 and 0 < len(audio) / rate < 25
    audio = torchaudio.functional.resample(torch.from_numpy(audio), rate, 24000)
    pcm = (audio.clamp(-1, 1) * 32767).round().to(torch.int16).numpy().tobytes()
    payloads = {"speech": pcm, "silence": b"\0" * 240000}
    segments = []
    for source_id, data in payloads.items():
        start = 0 if source_id == "speech" else 25000
        segments.append(
            {
                "source_id": source_id,
                "speaker_id": "fixture-speaker",
                "speaker_name": "Fixture speaker",
                "start_ms": start,
                "end_ms": start + round(len(data) / 48),
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "sample_rate": 24000,
            }
        )
    job = {
        "job": "smoke-job",
        "lease_token": "smoke-lease",
        "model": {
            "identifier": MODEL,
            "revision": REVISION,
            "precision": "float16",
            "configuration": copy.deepcopy(CONFIGURATION),
        },
        "hints": make_hints("", []),
        "manifest": {"segments": segments, "gaps": []},
    }

    class Queue:
        completed = None

        def call(self, operation, body):
            if operation == "heartbeat":
                return {"manifest": copy.deepcopy(job["manifest"])}
            if operation == "complete":
                self.completed = body
                return {"status": "Ready"}
            raise AssertionError("Real model worker did not complete")

        def source(self, source, authorized):
            data = payloads[source.source_id]
            source.check_audio(data)
            return data

    recognizer = TrelisRecognizer(args.cache)
    queue = Queue()
    outcome = Processor(recognizer, Metrics(), threading.Event()).process(queue, job)
    assert outcome is None and queue.completed is not None
    by_source = {item["source_id"]: item["text"] for item in queue.completed["segments"]}
    expected = words(Path(args.reference_file).read_text())
    errors = distance(expected, words(by_source["speech"]))
    assert errors == 0, "Speech reference mismatch"
    assert by_source["silence"] == "", "Digital silence produced text"
    print(
        json.dumps(
            {
                "status": "passed",
                "speech_reference_words": len(expected),
                "speech_word_errors": errors,
                "silence_words": len(words(by_source["silence"])),
                "processed_sources": len(by_source),
                "peak_allocated_mib": torch.cuda.max_memory_allocated() / 1024**2,
                "versions": {
                    key: importlib.metadata.version(key) for key in ["torch", "torchaudio", "transformers"]
                },
            }
        )
    )


if __name__ == "__main__":
    main()
