"""Validated, bounded inputs shared by the coordinator and recognizer."""

import hashlib
import math
from dataclasses import dataclass
from urllib.parse import urlsplit

try:
    from speech_context import CURRENT_VERSION, hint_phrases, make_hints, validate_hints, vocabulary
except ModuleNotFoundError:
    from suite.meet.speech_context import (
        CURRENT_VERSION,
        hint_phrases,
        make_hints,
        validate_hints,
        vocabulary,
    )

MODEL = "Trelis/whisper-hinglish-preview"
REVISION = "eab1188fd2d0e91f2584229b32b3bfe1901c896c"
CONFIGURATION = {
    "language": "auto",
    "task": "transcribe",
    "mixedcode_token_id": 51866,
    "sample_rate": 24000,
    "inference_sample_rate": 16000,
    "encoding": "pcm_s16le",
    "decoding_version": "trelis-auto-mixedcode-greedy-hints-v1",
    "vocabulary_version": CURRENT_VERSION,
    "max_hint_tokens": 64,
    "max_new_tokens": 440,
    "num_beams": 1,
    "do_sample": False,
    "condition_on_prev_tokens": False,
}
MAX_SEGMENT_BYTES = 2 * 1024 * 1024
MAX_SEGMENTS = 10000


class WorkError(Exception):
    def __init__(self, code: str, *, transient: bool = False):
        super().__init__(code)
        self.code = code
        self.transient = transient


def origin(value: str, *, allow_http: bool = False) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in ({"https", "http"} if allow_http else {"https"})
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Expected an explicit origin without credentials, path, query or fragment")
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def number(value, *, maximum: float = 4 * 60 * 60 * 1000) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WorkError("invalid_manifest")
    if not math.isfinite(value) or not 0 <= value <= maximum:
        raise WorkError("invalid_manifest")
    return value


def text(value, *, maximum=256) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise WorkError("invalid_manifest")
    return value


def validate_model(value: dict) -> None:
    # Never combine earlier Granite checkpoints with new Trelis results.
    expected = {
        "identifier": MODEL,
        "revision": REVISION,
        "precision": "float16",
        "configuration": CONFIGURATION,
    }
    try:
        version = value["configuration"]["vocabulary_version"]
        vocabulary(version)
        expected["configuration"] = {**CONFIGURATION, "vocabulary_version": version}
    except (KeyError, TypeError, ValueError):
        raise WorkError("unsupported_model_configuration") from None
    if not isinstance(value, dict) or value != expected:
        raise WorkError("unsupported_model_configuration")


@dataclass(frozen=True)
class Source:
    source_id: str
    speaker_id: str
    speaker_name: str
    start_ms: float
    end_ms: float
    size: int
    sha256: str
    sample_rate: int

    @classmethod
    def parse(cls, value: dict):
        if not isinstance(value, dict):
            raise WorkError("invalid_manifest")
        start, end = number(value.get("start_ms")), number(value.get("end_ms"))
        size = value.get("size")
        rate = value.get("sample_rate")
        digest = value.get("sha256")
        if (
            end <= start
            or end - start > 30000
            or rate != 24000
            or isinstance(size, bool)
            or not isinstance(size, int)
            or not 0 < size <= MAX_SEGMENT_BYTES
            or size % 2
            or not isinstance(digest, str)
            or len(digest) != 64
            or any(c not in "0123456789abcdef" for c in digest)
            or abs(size / 2 / rate * 1000 - (end - start)) > 100
            or value.get("encoding", "pcm_s16le") != "pcm_s16le"
        ):
            raise WorkError("invalid_manifest")
        return cls(
            text(value.get("source_id"), maximum=128),
            text(value.get("speaker_id"), maximum=256),
            text(value.get("speaker_name"), maximum=200),
            start,
            end,
            size,
            digest,
            rate,
        )

    def check_audio(self, data: bytes) -> None:
        if len(data) != self.size or hashlib.sha256(data).hexdigest() != self.sha256:
            raise WorkError("source_integrity_failed")

    def result(self, transcript: str) -> dict:
        if not isinstance(transcript, str) or len(transcript) > 32768:
            raise WorkError("invalid_model_output")
        return {
            "source_id": self.source_id,
            "speaker_id": self.speaker_id,
            "speaker_name": self.speaker_name,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "text": transcript,
        }

    def gap(self, reason: str) -> dict:
        return {"start_ms": self.start_ms, "end_ms": self.end_ms, "reason": reason}


def sources(manifest: dict) -> list[Source]:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("segments"), list):
        raise WorkError("invalid_manifest")
    if len(manifest["segments"]) > MAX_SEGMENTS:
        raise WorkError("invalid_manifest")
    result = [Source.parse(item) for item in manifest["segments"]]
    if len({item.source_id for item in result}) != len(result):
        raise WorkError("invalid_manifest")
    return result
