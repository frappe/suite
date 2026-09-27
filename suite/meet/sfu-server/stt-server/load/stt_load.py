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
FRAME_MS = 20
FRAME_BYTES = SAMPLE_RATE * 2 * FRAME_MS // 1000


def read_pcm(path: Path) -> bytes:
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, SAMPLE_RATE):
            raise ValueError("Input must be 24 kHz mono PCM16 WAV")
        pcm = audio.readframes(audio.getnframes())
    if not pcm:
        raise ValueError("Input audio is empty")
    return pcm


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(len(ordered) * fraction) - 1)], 3)


def summarize(results: list[dict], elapsed: float) -> dict:
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
    url: str, key: str, pcm: bytes, stream_id: int, rounds: int, gap: float, timeout: float, start_at: float
) -> list[dict]:
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
                                        "transcription": {"model": model, "language": "en-US"},
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
                            if event.get("delta") and rows[index]["first_text_seconds"] is None:
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
                    for index in range(rounds):
                        started = start_at + index * (len(pcm) / (SAMPLE_RATE * 2) + gap)
                        await asyncio.sleep(max(0, started - time.monotonic()))
                        starts.append(started)
                        for offset in range(0, len(pcm), FRAME_BYTES):
                            frame = pcm[offset : offset + FRAME_BYTES]
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
    pcm = read_pcm(args.audio)
    duration = len(pcm) / (SAMPLE_RATE * 2)
    if duration > 15:
        raise ValueError("Clip must be <= 15 seconds (Meet's maximum utterance)")
    if args.streams < 1 or args.rounds < 1 or args.gap < 0 or args.timeout <= 0:
        raise ValueError("streams, rounds and timeout must be positive; gap must be nonnegative")
    key = os.environ.get("STT_API_KEY")
    if not key:
        raise ValueError("Set STT_API_KEY for the isolated STT deployment")
    url = args.url.rstrip("/") + "/v1/realtime"
    start = time.monotonic()
    rows = [
        row
        for group in await asyncio.gather(
            *[
                run_stream(url, key, pcm, i, args.rounds, args.gap, args.timeout, start + 1)
                for i in range(args.streams)
            ]
        )
        for row in group
    ]
    return {
        "configuration": {
            "streams": args.streams,
            "rounds": args.rounds,
            "gap_seconds": args.gap,
            "audio_seconds": round(duration, 3),
        },
        "summary": summarize(rows, time.monotonic() - start),
        "utterances": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Isolated STT base URL (http(s) or ws(s))")
    parser.add_argument(
        "--audio", type=Path, required=True, help="24 kHz mono PCM16 WAV containing speech and silence"
    )
    parser.add_argument("--streams", type=int, required=True, help="Simultaneous active speaker streams")
    parser.add_argument("--rounds", type=int, default=12)
    parser.add_argument("--gap", type=float, default=1.0, help="Silence between utterances in seconds")
    parser.add_argument("--timeout", type=float, default=600, help="Total timeout per stream in seconds")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.url = args.url.replace("https://", "wss://").replace("http://", "ws://")
    report = asyncio.run(run(args))
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["summary"], indent=2))
    if report["summary"]["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
