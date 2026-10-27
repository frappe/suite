"""Bounded, content-safe validation shared by capture admission and queue delivery."""

from __future__ import annotations

import math
import re

from suite.meet.speech_context import CURRENT_VERSION, validate_hints, validate_names

MODEL = {
    "identifier": "Trelis/whisper-hinglish-preview",
    "revision": "eab1188fd2d0e91f2584229b32b3bfe1901c896c",
    "precision": "float16",
    "configuration": {
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
    },
}
MAX_DURATION_MS = 14400000
MAX_SEGMENTS = 10000
ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def integer(value, minimum=0, maximum=MAX_DURATION_MS):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Invalid transcription interval or size")
    return value


def interval(item):
    start = integer(item.get("start_ms"))
    end = integer(item.get("end_ms"))
    if end <= start:
        raise ValueError("Invalid transcription interval")
    return start, end


def validate_gaps(gaps):
    if not isinstance(gaps, list) or len(gaps) > MAX_SEGMENTS:
        raise ValueError("Invalid transcription gaps")
    for gap in gaps:
        interval(gap)
        if not isinstance(gap.get("reason"), str) or not re.fullmatch(r"[a-z_]{1,64}", gap["reason"]):
            raise ValueError("Invalid transcription gap reason")
    return gaps


def validate_manifest(manifest, capture, site, room, max_bytes):
    if not isinstance(manifest, dict) or (
        manifest.get("capture"),
        manifest.get("site"),
        manifest.get("room"),
    ) != (capture, site, room):
        raise ValueError("Transcription source identity mismatch")
    sources = manifest.get("segments")
    if not isinstance(sources, list) or len(sources) > MAX_SEGMENTS:
        raise ValueError("Invalid transcription sources")
    seen = set()
    size = 0
    duration = 0
    for source in sources:
        source_id = source.get("source_id")
        if not isinstance(source_id, str) or not ID.fullmatch(source_id) or source_id in seen:
            raise ValueError("Invalid transcription source identifier")
        seen.add(source_id)
        start, end = interval(source)
        if end - start > 30000:
            raise ValueError("Transcription source exceeds segment duration limit")
        if (
            source.get("sample_rate") != 24000
            or not isinstance(source.get("speaker_id"), str)
            or not source["speaker_id"]
            or len(source["speaker_id"]) > 256
        ):
            raise ValueError("Invalid transcription speaker or sample rate")
        if (
            not isinstance(source.get("speaker_name"), str)
            or not source["speaker_name"].strip()
            or len(source["speaker_name"]) > 200
        ):
            raise ValueError("Invalid transcription speaker name")
        length = integer(source.get("size"), 2, max_bytes)
        # PCM16 mono, allowing one millisecond's timestamp rounding.
        if length % 2 or abs(length / 48 - (end - start)) > 2:
            raise ValueError("Transcription source duration mismatch")
        if not isinstance(source.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", source["sha256"]):
            raise ValueError("Invalid transcription source digest")
        size += length
        duration += (end - start) / 1000
    if size > max_bytes or not math.isfinite(duration):
        raise ValueError("Transcription source storage limit exceeded")
    if "participant_names" in manifest:
        manifest = {
            **manifest,
            "participant_names": validate_names(manifest["participant_names"], maximum=100),
        }
    if "speech_context" in manifest:
        context = manifest["speech_context"]
        if not isinstance(context, dict) or set(context) != {"vocabulary_version", "title"}:
            raise ValueError("Invalid transcription speech context")
        validate_hints({**context, "participant_names": []})
    validate_gaps(manifest.get("gaps", []))
    return {**manifest, "audio_seconds": duration, "source_bytes": size}


def validate_results(segments, manifest):
    if not isinstance(segments, list) or len(segments) > MAX_SEGMENTS:
        raise ValueError("Invalid transcription results")
    sources = {s["source_id"]: s for s in manifest["segments"]}
    seen = set()
    for segment in segments:
        source_id = segment.get("source_id")
        source = sources.get(source_id)
        if not source or source_id in seen:
            raise ValueError("Unrecognized or repeated transcription result")
        seen.add(source_id)
        if any(segment.get(k) != source[k] for k in ("speaker_id", "speaker_name", "start_ms", "end_ms")):
            raise ValueError("Transcription attribution mismatch")
        text = segment.get("text")
        if not isinstance(text, str) or len(text) > 100000 or "\x00" in text:
            raise ValueError("Invalid transcription text")
    return segments


def timestamp(milliseconds):
    seconds = milliseconds // 1000
    return f"{seconds // 3600:02}:{seconds // 60 % 60:02}:{seconds % 60:02}"


def render_transcript(segments, gaps, partial):
    lines = [
        "Partial transcript — speech may be missing within the marked intervals."
        if partial
        else "Transcript",
        "",
    ]
    events = [
        (
            s["start_ms"],
            f"[{timestamp(s['start_ms'])} - {timestamp(s['end_ms'])}] {' '.join(s['speaker_name'].splitlines())}: {' '.join(s['text'].splitlines())}",
        )
        for s in segments
        if s["text"].strip()
    ]
    events += [
        (
            g["start_ms"],
            f"[{timestamp(g['start_ms'])} - {timestamp(g['end_ms'])}] [{'Possible missing audio' if g['reason'] in ('service_restart', 'source_interrupted') else 'Missing audio'}: {g['reason'].replace('_', ' ')}]",
        )
        for g in gaps
    ]
    lines.extend(text for _, text in sorted(events, key=lambda event: event[0]))
    if not events:
        lines.append("[No speech detected]")
    return "\n".join(lines) + "\n"
