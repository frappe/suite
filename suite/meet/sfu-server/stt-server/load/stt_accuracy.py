"""Evaluate consented, manually transcribed clips against isolated STT or saved predictions."""

import argparse
import asyncio
import base64
import json
import math
import os
import sys
import time
import unicodedata
from collections import Counter
from pathlib import Path

from stt_load import SAMPLE_RATE, percentile, read_pcm
from websockets.asyncio.client import connect


def words(text: str) -> list[str]:
    """Ignore case/punctuation; retain Unicode letters, numbers and internal apostrophes."""
    text = unicodedata.normalize("NFKC", text).casefold().replace("\u2019", "'")
    text = "".join(
        c if c.isalnum() or unicodedata.category(c).startswith("M") or c == "'" else " " for c in text
    )
    return [word.strip("'") for word in text.split() if word.strip("'")]


def word_errors(reference: list[str], hypothesis: list[str]) -> int:
    """Minimum word insertions, deletions and substitutions (Levenshtein distance)."""
    previous = list(range(len(hypothesis) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, actual in enumerate(hypothesis, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1]


def name_counts(tokens: list[str], names: list[str]) -> Counter:
    """Count exact roster-name phrases, longest first so nested names aren't counted twice."""
    phrases = sorted(((name, words(name)) for name in names), key=lambda pair: -len(pair[1]))
    counts = Counter()
    index = 0
    while index < len(tokens):
        for name, phrase in phrases:
            if tokens[index : index + len(phrase)] == phrase:
                counts[name] += 1
                index += len(phrase)
                break
        else:
            index += 1
    return counts


def load_manifest(path: Path) -> list[dict]:
    manifest = json.loads(path.read_text())
    if (
        not isinstance(manifest, dict)
        or manifest.get("version") != 1
        or not isinstance(manifest.get("clips"), list)
        or not manifest["clips"]
    ):
        raise ValueError("Manifest must have version 1 and a nonempty clips array")
    clips = []
    ids = set()
    for entry in manifest["clips"]:
        if not isinstance(entry, dict):
            raise ValueError("Each clip must be an object")
        for field in ("id", "audio", "accent", "language"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"Clip requires nonempty {field}")
        if entry["id"] in ids:
            raise ValueError("Clip IDs must be unique")
        ids.add(entry["id"])
        if "scenario" in entry and (not isinstance(entry["scenario"], str) or not entry["scenario"].strip()):
            raise ValueError("scenario must be a nonempty string")
        licensed = (
            isinstance(entry.get("dataset_license"), str)
            and bool(entry["dataset_license"].strip())
            and isinstance(entry.get("source_url"), str)
            and entry["source_url"].startswith("https://")
        )
        if (entry.get("consented") is not True and not licensed) or not isinstance(
            entry.get("reference"), str
        ):
            raise ValueError(
                "Each clip needs consent or a documented dataset license/source, and a reference"
            )
        names = entry.get("names", [])
        lattice = entry.get("reference_lattice")
        if lattice is not None and (
            not isinstance(lattice, list)
            or not lattice
            or any(
                not isinstance(slot, list)
                or not slot
                or any(not isinstance(variant, str) or not words(variant) for variant in slot)
                for slot in lattice
            )
            or entry.get("oiwer_language") != "hindi"
        ):
            raise ValueError("reference_lattice needs nonempty variant slots and oiwer_language=hindi")
        if (
            not isinstance(names, list)
            or len(names) > 20
            or any(
                not isinstance(name, str)
                or not words(name)
                or len(name) > 80
                or any(unicodedata.category(c)[0] == "C" for c in name)
                for name in names
            )
        ):
            raise ValueError("names must contain at most 20 nonempty printable names, <=80 characters each")
        normalized = [tuple(words(name)) for name in names]
        if len(set(normalized)) != len(normalized):
            raise ValueError("Name hints must be unique after normalization")
        end = entry.get("speech_end_seconds")
        if end is not None and (
            isinstance(end, bool) or not isinstance(end, (int, float)) or not math.isfinite(end) or end < 0
        ):
            raise ValueError("Annotate nonnegative speech_end_seconds (last spoken sound)")
        clips.append(
            {**entry, "speech_end_seconds": end, "names": names, "audio_path": path.parent / entry["audio"]}
        )
    return clips


def score_clip(clip: dict, prediction: dict) -> dict:
    if not isinstance(prediction, dict) or not isinstance(prediction.get("failed", False), bool):
        raise ValueError("Prediction must be an object with a boolean failed flag")
    transcript = prediction.get("transcript")
    if not isinstance(transcript, str):
        raise ValueError("Each prediction requires a transcript string, including failures")
    reference, hypothesis = words(clip["reference"]), words(transcript)
    expected, observed = name_counts(reference, clip["names"]), name_counts(hypothesis, clip["names"])
    row = {
        "id": clip["id"],
        "accent": clip["accent"],
        "language": clip["language"],
        "scenario": clip.get("scenario", "general"),
        "failed": prediction.get("failed", False) or (bool(reference) and not bool(hypothesis)),
        "reference_words": len(reference),
        "word_errors": word_errors(reference, hypothesis),
        "expected_name_mentions": sum(expected.values()),
        "correct_name_mentions": sum((expected & observed).values()),
        "false_name_mentions": sum((observed - expected).values()),
    }
    if clip.get("reference_lattice") is not None:
        from voi_oiwer import oiwer

        _, _, _, _, errors, count, _, _ = oiwer(
            hypothesis=transcript,
            reference_lists=clip["reference_lattice"],
            input_language=clip["oiwer_language"],
        )
        row["oiwer_word_errors"] = sum(errors)
        row["oiwer_reference_words"] = count
    for label, text in (("reference", clip["reference"]), ("hypothesis", transcript)):
        row[label + "_devanagari_letters"] = sum(
            "\u0900" <= char <= "\u097f" and unicodedata.category(char).startswith("L") for char in text
        )
    row["unexpected_devanagari_letters"] = (
        row["hypothesis_devanagari_letters"] if not row["reference_devanagari_letters"] else None
    )
    for field in (
        "first_text_seconds",
        "final_after_speech_seconds",
        "final_after_audio_seconds",
        "max_sender_lag_seconds",
    ):
        value = prediction.get(field)
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < 0
        ):
            raise ValueError(f"Invalid {field}")
        row[field] = value
    return row


def summarize_accuracy(rows: list[dict]) -> dict:
    total = {
        field: sum(row[field] for row in rows)
        for field in (
            "reference_words",
            "word_errors",
            "expected_name_mentions",
            "correct_name_mentions",
            "false_name_mentions",
        )
    }
    total.update(
        {
            "clips": len(rows),
            "failed": sum(row["failed"] for row in rows),
            "wer": total["word_errors"] / total["reference_words"] if total["reference_words"] else None,
            "name_recall": (
                total["correct_name_mentions"] / total["expected_name_mentions"]
                if total["expected_name_mentions"]
                else None
            ),
            "missed_name_mentions": total["expected_name_mentions"] - total["correct_name_mentions"],
            "completed_without_interim": sum(
                not row["failed"] and row["first_text_seconds"] is None for row in rows
            ),
            "reference_without_devanagari_clips_with_devanagari": sum(
                bool(row["unexpected_devanagari_letters"]) for row in rows
            ),
            "unexpected_devanagari_letters": sum(row["unexpected_devanagari_letters"] or 0 for row in rows),
        }
    )
    for field in ("first_text_seconds", "final_after_speech_seconds", "final_after_audio_seconds"):
        values = [row[field] for row in rows if not row["failed"] and row[field] is not None]
        total[field] = {
            "samples": len(values),
            "p50": percentile(values, 0.5),
            "p95": percentile(values, 0.95),
        }
    total["max_sender_lag_seconds"] = max((row["max_sender_lag_seconds"] or 0 for row in rows), default=0)
    lattice_rows = [row for row in rows if "oiwer_word_errors" in row]
    if lattice_rows:
        errors = sum(row["oiwer_word_errors"] for row in lattice_rows)
        count = sum(row["oiwer_reference_words"] for row in lattice_rows)
        total["oiwer"] = {
            "clips": len(lattice_rows),
            "word_errors": errors,
            "reference_words": count,
            "rate": errors / count if count else None,
        }
    return total


def make_report(clips: list[dict], predictions: dict, label: str, image_digest: str | None) -> dict:
    if not isinstance(predictions, dict) or set(predictions) != {clip["id"] for clip in clips}:
        raise ValueError("Prediction IDs must exactly match the manifest; missing clips cannot be excluded")
    rows = [score_clip(clip, predictions[clip["id"]]) for clip in clips]
    return {
        "version": 1,
        "label": label,
        "image_digest": image_digest,
        "summary": summarize_accuracy(rows),
        "by_accent": {
            accent: summarize_accuracy([row for row in rows if row["accent"] == accent])
            for accent in sorted({row["accent"] for row in rows})
        },
        "by_language": {
            language: summarize_accuracy([row for row in rows if row["language"] == language])
            for language in sorted({row["language"] for row in rows})
        },
        "by_scenario": {
            scenario: summarize_accuracy([row for row in rows if row["scenario"] == scenario])
            for scenario in sorted({row["scenario"] for row in rows})
        },
        "clips": rows,
    }


async def transcribe(
    url: str, key: str, clip: dict, pcm: bytes, hints: bool, timeout: float, language: str | None = None
) -> dict:
    """One paced utterance; keep first-interim timing separate from post-commit deltas."""
    result = {
        "transcript": "",
        "failed": True,
        "first_text_seconds": None,
        "final_after_speech_seconds": None,
        "max_sender_lag_seconds": 0.0,
    }
    try:
        async with asyncio.timeout(timeout):
            async with connect(url, additional_headers={"Authorization": f"Bearer {key}"}) as ws:
                created = json.loads(await ws.recv())
                if created.get("type") != "session.created":
                    raise ValueError("Expected session.created")
                model = created["session"]["audio"]["input"]["transcription"]["model"]
                await ws.send(
                    json.dumps(
                        {
                            "type": "session.update",
                            "session": {
                                "type": "transcription",
                                "audio": {
                                    "input": {
                                        "format": {"type": "audio/pcm", "rate": SAMPLE_RATE},
                                        "transcription": {
                                            "model": model,
                                            "language": language or clip["language"],
                                            **({"names": clip["names"]} if hints else {}),
                                        },
                                        "turn_detection": None,
                                    }
                                },
                            },
                        }
                    )
                )
                if json.loads(await ws.recv()).get("type") != "session.updated":
                    raise ValueError("Expected session.updated")
                start = time.monotonic()

                async def receive():
                    committed = False
                    async for raw in ws:
                        event = json.loads(raw)
                        kind = event.get("type")
                        if kind == "input_audio_buffer.committed":
                            committed = True
                        elif kind == "conversation.item.input_audio_transcription.delta":
                            if (
                                not committed
                                and event.get("delta", "").strip()
                                and result["first_text_seconds"] is None
                            ):
                                result["first_text_seconds"] = time.monotonic() - start
                        elif kind == "conversation.item.input_audio_transcription.completed":
                            if not committed or not isinstance(event.get("transcript"), str):
                                raise ValueError("Invalid completion")
                            result["transcript"] = event["transcript"]
                            result["failed"] = bool(words(clip["reference"])) and not bool(
                                words(event["transcript"])
                            )
                            elapsed = time.monotonic() - start
                            result["final_after_audio_seconds"] = elapsed - len(pcm) / (SAMPLE_RATE * 2)
                            if clip.get("speech_end_seconds") is not None:
                                result["final_after_speech_seconds"] = elapsed - clip["speech_end_seconds"]
                            return
                        elif kind in ("error", "conversation.item.input_audio_transcription.failed"):
                            raise ValueError("STT rejected or failed the utterance")
                    raise ValueError("Connection closed before completion")

                receiver = asyncio.create_task(receive())
                try:
                    for offset in range(0, len(pcm), 4800):
                        target = start + offset / (SAMPLE_RATE * 2)
                        await asyncio.sleep(max(0, target - time.monotonic()))
                        result["max_sender_lag_seconds"] = max(
                            result["max_sender_lag_seconds"], time.monotonic() - target
                        )
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "input_audio_buffer.append",
                                    "audio": base64.b64encode(pcm[offset : offset + 4800]).decode(),
                                }
                            )
                        )
                    await asyncio.sleep(max(0, start + len(pcm) / (SAMPLE_RATE * 2) - time.monotonic()))
                    await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
                    await receiver
                finally:
                    if not receiver.done():
                        receiver.cancel()
                    await asyncio.gather(receiver, return_exceptions=True)
    except Exception as error:
        # Do not serialize server error messages, credentials or transcript-bearing exceptions.
        result["error_type"] = type(error).__name__
    return result


async def replay(args, clips):
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        raise ValueError("timeout must be positive and finite")
    key = os.environ.get("STT_API_KEY")
    if not key:
        raise ValueError("Set STT_API_KEY for the isolated replica")
    # Preflight every clip before opening any connection.
    audio = {clip["id"]: read_pcm(clip["audio_path"]) for clip in clips}
    for clip in clips:
        duration = len(audio[clip["id"]]) / (SAMPLE_RATE * 2)
        if duration > 15 or (
            clip["speech_end_seconds"] is not None and clip["speech_end_seconds"] > duration
        ):
            raise ValueError("Clips must be <=15 seconds; speech_end_seconds must be within audio")
    url = args.url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/") + "/v1/realtime"
    predictions = {}
    for index, clip in enumerate(clips, 1):
        predictions[clip["id"]] = await transcribe(
            url, key, clip, audio[clip["id"]], not args.no_hints, args.timeout, args.language
        )
        status = "failed" if predictions[clip["id"]]["failed"] else "completed"
        print(f"Clip {index}/{len(clips)}: {status}", file=sys.stderr, flush=True)
    return predictions


def write_private(path: Path, value: dict):
    """Reports and optional prediction exports are private to the current user."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(json.dumps(value, indent=2, allow_nan=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--url", help="Isolated STT base URL; never load-test the live service")
    mode.add_argument("--predictions", type=Path, help="Offline JSON object keyed by clip ID")
    parser.add_argument("--label", required=True, help="Experiment label, e.g. baseline or hints-1.5")
    parser.add_argument("--image-digest", help="Exact evaluated image digest for reproducibility")
    parser.add_argument("--no-hints", action="store_true", help="Replay without roster hints (ablation)")
    parser.add_argument("--language", help="Override every clip's language prompt, e.g. auto or en-US")
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--save-predictions", type=Path, help="Opt-in PRIVATE transcript export; keep outside git"
    )
    args = parser.parse_args()
    for path in (args.output, args.save_predictions):
        if path is not None and not path.parent.is_dir():
            parser.error(f"Create the output directory before replay: {path.parent}")
    if args.predictions and (args.no_hints or args.language):
        parser.error("--no-hints and --language only apply to replay")
    clips = load_manifest(args.manifest)
    predictions = (
        json.loads(args.predictions.read_text()) if args.predictions else asyncio.run(replay(args, clips))
    )
    report = make_report(clips, predictions, args.label, args.image_digest)
    report["mode"] = "offline" if args.predictions else "replay"
    if not args.predictions:
        report["hints_enabled"] = not args.no_hints
        report["language_override"] = args.language
    write_private(args.output, report)
    if args.save_predictions:
        write_private(args.save_predictions, predictions)
    print(json.dumps(report["summary"], indent=2))
    if report["summary"]["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
