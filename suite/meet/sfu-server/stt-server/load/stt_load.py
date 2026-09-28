"""Paced, concurrent load test of the public Meet STT Realtime endpoint.

Run only against an isolated STT deployment. Requires `websockets` (not the
production image): uv run --no-project --with websockets python load/stt_load.py --help
"""

import argparse
import asyncio
import base64
import json
import math
import os
import time
import wave
from pathlib import Path

from websockets.asyncio.client import connect

SAMPLE_RATE = 24000
DEFAULT_FRAME_MS = 100  # SFU AudioIngester sends 100 ms VAD frames.


def read_pcm(path: Path) -> bytes:
    """Read a nonempty 24 kHz mono PCM16 speech clip for paced playback."""
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError("Input must be 24 kHz mono PCM16 WAV")
        pcm = audio.readframes(audio.getnframes())
    if not pcm:
        raise ValueError("Input audio is empty")
    return pcm


def percentile(values: list[float], fraction: float) -> float | None:
    """Return the nearest-rank percentile, or None for an empty sample."""
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(len(ordered) * fraction) - 1)], 3)


def summarize(results: list[dict], elapsed: float) -> dict:
    """Summarize completed rounds, interim-caption delay, failures, and sender lag."""
    # Results arrive grouped by connection, not by time.
    results = sorted(results, key=lambda row: row["round"])
    completed = [row for row in results if row["completed"]]
    first = [row["first_text_seconds"] for row in completed if row["first_text_seconds"] is not None]
    finals = [row["final_after_audio_seconds"] for row in completed]
    halfway = len(results) // 2
    return {
        "attempted": len(results),
        "completed": len(completed),
        "failed": len(results) - len(completed),
        "completed_without_interim": len(completed) - len(first),
        "elapsed_seconds": round(elapsed, 3),
        "first_text_seconds": {
            "p50": percentile(first, 0.5),
            "p95": percentile(first, 0.95),
            "p99": percentile(first, 0.99),
        },
        "final_after_audio_seconds": {
            "p50": percentile(finals, 0.5),
            "p95": percentile(finals, 0.95),
            "p99": percentile(finals, 0.99),
        },
        "early_final_p95": percentile(
            [r["final_after_audio_seconds"] for r in results[:halfway] if r["completed"]], 0.95
        ),
        "late_final_p95": percentile(
            [r["final_after_audio_seconds"] for r in results[halfway:] if r["completed"]], 0.95
        ),
        "max_sender_lag_seconds": round(max((r["max_sender_lag_seconds"] for r in results), default=0), 3),
    }


async def run_stream(
    url: str,
    key: str,
    pcm: bytes,
    stream_id: int,
    rounds: int,
    gap: float,
    timeout: float,
    start_at: float,
    ready: asyncio.Barrier | None = None,
    frame_ms: int = DEFAULT_FRAME_MS,
    stagger_ms: int = 0,
    language: str | None = None,
    name: str | None = None,
) -> list[dict]:
    """Pace utterances by audio time; return one success or failure row per round."""
    rows = [
        {
            "stream": stream_id,
            "round": index,
            "completed": False,
            "first_text_seconds": None,
            "final_after_audio_seconds": None,
            "max_sender_lag_seconds": 0.0,
            "error": None,
        }
        for index in range(rounds)
    ]
    try:
        async with asyncio.timeout(timeout):
            async with connect(
                url, additional_headers={"Authorization": f"Bearer {key}"}, max_size=1024 * 1024
            ) as ws:
                created = json.loads(await ws.recv())
                if created.get("type") != "session.created":
                    raise ValueError(f"Expected session.created, got {created.get('type')}")
                transcription = created["session"]["audio"]["input"]["transcription"]
                model = transcription["model"]
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
                                            "language": language or transcription["language"],
                                            **({"names": [name]} if name else {}),
                                        },
                                        "turn_detection": None,
                                    }
                                },
                            },
                        }
                    )
                )
                updated = json.loads(await ws.recv())
                if updated.get("type") != "session.updated":
                    raise ValueError(f"Expected session.updated, got {updated.get('type')}")
                if ready is not None:
                    await asyncio.wait_for(ready.wait(), timeout=min(timeout, 20))
                    start_at = time.monotonic() + 0.2
                start_at += stream_id * stagger_ms / 1000

                starts: list[float] = []
                ends: list[float] = []

                async def receive_results() -> None:
                    acknowledged = 0
                    finished = 0
                    items: dict[str, int] = {}
                    while finished < rounds:
                        event = json.loads(await ws.recv())
                        kind = event.get("type")
                        if kind == "error":
                            raise ValueError(str(event.get("error")))
                        if kind == "input_audio_buffer.committed":
                            if acknowledged >= len(starts):
                                raise ValueError("Unexpected commit acknowledgement")
                            items[event["item_id"]] = acknowledged
                            acknowledged += 1
                            continue
                        index = items.get(event.get("item_id"))
                        # Interim deltas can arrive before the commit acknowledgement.
                        if (
                            index is None
                            and kind == "conversation.item.input_audio_transcription.delta"
                            and acknowledged < len(starts)
                        ):
                            index = acknowledged
                        if index is None:
                            continue
                        if kind == "conversation.item.input_audio_transcription.failed":
                            rows[index]["error"] = str(event.get("error"))
                            finished += 1
                        elif kind == "conversation.item.input_audio_transcription.delta":
                            # The server acknowledges commit before emitting final deltas.
                            # Earlier deltas remain interim even if read after we send commit.
                            if (
                                event.get("delta")
                                and index >= acknowledged
                                and rows[index]["first_text_seconds"] is None
                            ):
                                rows[index]["first_text_seconds"] = round(time.monotonic() - starts[index], 3)
                        elif kind == "conversation.item.input_audio_transcription.completed":
                            if (event.get("transcript") or "").strip():
                                rows[index]["completed"] = True
                                rows[index]["final_after_audio_seconds"] = round(
                                    time.monotonic() - ends[index], 3
                                )
                            else:
                                rows[index]["error"] = "Empty final transcript for speech clip"
                            finished += 1
                        else:
                            continue
                        if kind != "conversation.item.input_audio_transcription.delta":
                            del items[event["item_id"]]

                await asyncio.sleep(max(0, start_at - time.monotonic()))
                receiver = asyncio.create_task(receive_results())
                try:
                    frame_bytes = SAMPLE_RATE * 2 * frame_ms // 1000
                    for index in range(rounds):
                        started = start_at + index * (len(pcm) / (SAMPLE_RATE * 2) + gap)
                        await asyncio.sleep(max(0, started - time.monotonic()))
                        starts.append(started)
                        for offset in range(0, len(pcm), frame_bytes):
                            frame = pcm[offset : offset + frame_bytes]
                            target = started + offset / (SAMPLE_RATE * 2)
                            await asyncio.sleep(max(0, target - time.monotonic()))
                            rows[index]["max_sender_lag_seconds"] = max(
                                rows[index]["max_sender_lag_seconds"], time.monotonic() - target
                            )
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "input_audio_buffer.append",
                                        "audio": base64.b64encode(frame).decode(),
                                    }
                                )
                            )
                        audio_end = started + len(pcm) / (SAMPLE_RATE * 2)
                        await asyncio.sleep(max(0, audio_end - time.monotonic()))
                        ends.append(audio_end)
                        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
                        # Do not wait for transcription; a slow server must visibly accumulate lag.
                    await receiver
                finally:
                    if not receiver.done():
                        receiver.cancel()
                    await asyncio.gather(receiver, return_exceptions=True)
    except (Exception, asyncio.CancelledError) as error:
        for row in rows:
            if not row["completed"] and row["error"] is None:
                row["error"] = f"{type(error).__name__}: {error}"
    return rows


async def run(args: argparse.Namespace) -> dict:
    """Run paced streams against isolated replica(s) and build the report."""
    pcm = read_pcm(args.audio)
    duration = len(pcm) / (SAMPLE_RATE * 2)
    if duration > 15:
        raise ValueError("Clip must be <= 15 seconds (Meet's maximum utterance)")
    if args.streams < 1 or args.rounds < 1 or args.gap < 0 or args.timeout <= 0:
        raise ValueError("streams, rounds and timeout must be positive; gap must be nonnegative")
    if args.frame_ms <= 0 or args.frame_ms > 200 or args.frame_ms % 20:
        raise ValueError("frame-ms must be a multiple of 20 between 20 and 200")
    if args.stagger_ms < 0:
        raise ValueError("stagger-ms must be nonnegative")
    if args.trim_ms_step < 0 or (args.streams - 1) * args.trim_ms_step >= duration * 1000:
        raise ValueError("trim-ms-step must leave audio on every stream")
    languages = [value.strip() for value in args.languages.split(",")] if args.languages else []
    names = [value.strip() for value in args.names.split(",")] if args.names else []
    if any(not value for value in (*languages, *names)):
        raise ValueError("languages and names must be comma-separated nonempty values")
    key = os.environ.get("STT_API_KEY")
    if not key:
        raise ValueError("Set STT_API_KEY for the isolated STT deployment")
    base_urls = [url.strip() for url in args.urls.split(",")] if args.urls else [args.url]
    if not all(base_urls):
        raise ValueError("Provide nonempty replica URLs")
    urls = [url.rstrip("/") + "/v1/realtime" for url in base_urls]
    start = time.monotonic()
    ready = asyncio.Barrier(args.streams)
    rows = [
        row
        for group in await asyncio.gather(
            *[
                run_stream(
                    urls[i % len(urls)],
                    key,
                    pcm[: len(pcm) - i * args.trim_ms_step * SAMPLE_RATE * 2 // 1000],
                    i,
                    args.rounds,
                    args.gap,
                    args.timeout,
                    start + 1,
                    ready,
                    args.frame_ms,
                    args.stagger_ms,
                    languages[i % len(languages)] if languages else None,
                    names[i % len(names)] if names else None,
                )
                for i in range(args.streams)
            ]
        )
        for row in group
    ]
    return {
        "configuration": {
            "streams": args.streams,
            "replicas": len(urls),
            "rounds": args.rounds,
            "gap_seconds": args.gap,
            "audio_seconds": round(duration, 3),
            "frame_ms": args.frame_ms,
            "stagger_ms": args.stagger_ms,
            "languages": languages,
            "name_hints_per_stream": int(bool(names)),
            "trim_ms_step": args.trim_ms_step,
        },
        "summary": summarize(rows, time.monotonic() - start),
        "utterances": rows,
    }


def main() -> None:
    """Parse the load scenario, write its report, and fail on incomplete rounds."""
    parser = argparse.ArgumentParser(description=__doc__)
    endpoints = parser.add_mutually_exclusive_group(required=True)
    endpoints.add_argument("--url", help="Isolated STT base URL (http(s) or ws(s))")
    endpoints.add_argument("--urls", help="Comma-separated isolated replica URLs, assigned round-robin")
    parser.add_argument(
        "--audio", type=Path, required=True, help="24 kHz mono PCM16 WAV containing speech and silence"
    )
    parser.add_argument("--streams", type=int, required=True, help="Simultaneous active speaker streams")
    parser.add_argument("--frame-ms", type=int, default=DEFAULT_FRAME_MS, help="Audio packet size in ms")
    parser.add_argument("--rounds", type=int, default=12)
    parser.add_argument("--stagger-ms", type=int, default=0, help="Offset each stream's start")
    parser.add_argument("--languages", help="Comma-separated languages, assigned per stream")
    parser.add_argument(
        "--names", help="Comma-separated room-name hints, one per stream (repeated cyclically)"
    )
    parser.add_argument("--trim-ms-step", type=int, default=0, help="Vary final chunk sizes across streams")
    parser.add_argument("--gap", type=float, default=1.0, help="Silence between utterances in seconds")
    parser.add_argument("--timeout", type=float, default=600, help="Total timeout per stream in seconds")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.url:
        args.url = args.url.replace("https://", "wss://").replace("http://", "ws://")
    else:
        args.urls = args.urls.replace("https://", "wss://").replace("http://", "ws://")
    report = asyncio.run(run(args))
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["summary"], indent=2))
    if report["summary"]["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
