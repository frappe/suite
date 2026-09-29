import argparse
import asyncio
import json
import os
import tempfile
import time
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from stt_load import percentile, read_pcm, run, run_stream, summarize
from websockets.asyncio.server import serve


class LoadTest(unittest.TestCase):
    """Check paced STT harness behavior with a local Realtime server."""

    def test_replicas_receive_distinct_names_and_sfu_sized_frames(self):
        async def scenario(path):
            received = [[], []]

            def handler(replica):
                async def server(ws):
                    await ws.send(
                        json.dumps(
                            {
                                "type": "session.created",
                                "session": {
                                    "audio": {
                                        "input": {"transcription": {"model": "test", "language": "auto"}}
                                    }
                                },
                            }
                        )
                    )
                    update = json.loads(await ws.recv())
                    received[replica].append(update["session"]["audio"]["input"]["transcription"])
                    await ws.send(json.dumps({"type": "session.updated"}))
                    frames = []
                    async for raw in ws:
                        event = json.loads(raw)
                        if event["type"] == "input_audio_buffer.append":
                            import base64

                            frames.append(base64.b64decode(event["audio"]))
                        elif event["type"] == "input_audio_buffer.commit":
                            received[replica].append([len(frame) for frame in frames])
                            await ws.send(
                                json.dumps({"type": "input_audio_buffer.committed", "item_id": "one"})
                            )
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "conversation.item.input_audio_transcription.completed",
                                        "item_id": "one",
                                        "transcript": "recognized",
                                    }
                                )
                            )

                return server

            async with (
                serve(handler(0), "127.0.0.1", 0) as first,
                serve(handler(1), "127.0.0.1", 0) as second,
            ):
                urls = ",".join(f"ws://127.0.0.1:{s.sockets[0].getsockname()[1]}" for s in (first, second))
                with patch.dict(os.environ, {"STT_API_KEY": "test-key"}):
                    report = await run(
                        argparse.Namespace(
                            audio=path,
                            streams=2,
                            rounds=1,
                            gap=0,
                            timeout=5,
                            url=None,
                            urls=urls,
                            frame_ms=100,
                            stagger_ms=20,
                            languages="en-US,es-ES",
                            names="Siobhan,Zubair",
                            trim_ms_step=40,
                        )
                    )
            return report, received

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "audio.wav"
            with wave.open(str(path), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(24000)
                audio.writeframes(b"\0" * (24000 * 2 * 220 // 1000))
            report, received = asyncio.run(scenario(path))

        self.assertEqual(report["summary"]["completed"], 2)
        self.assertNotIn("Siobhan", json.dumps(report))
        self.assertNotIn("Zubair", json.dumps(report))
        self.assertEqual(received[0][0]["names"], ["Siobhan"])
        self.assertEqual(received[1][0]["names"], ["Zubair"])
        self.assertEqual(received[0][0]["language"], "en-US")
        self.assertEqual(received[1][0]["language"], "es-ES")
        self.assertEqual(received[0][1], [4800, 4800, 960])
        self.assertEqual(received[1][1], [4800, 3840])
        self.assertNotIn("recognized", json.dumps(report))
        self.assertNotIn("transcript_sha256", json.dumps(report))

    def test_requires_representative_input_format(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "audio.wav"
            with wave.open(str(path), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(b"\0" * 960)
            with self.assertRaisesRegex(ValueError, "24 kHz mono PCM16"):
                read_pcm(path)

    def test_percentile_and_failed_utterances(self):
        rows = [
            {
                "round": 0,
                "completed": True,
                "first_text_seconds": 0.2,
                "final_after_audio_seconds": 0.3,
                "max_sender_lag_seconds": 0.01,
            },
            {
                "round": 1,
                "completed": False,
                "first_text_seconds": None,
                "final_after_audio_seconds": None,
                "max_sender_lag_seconds": 0.02,
            },
            {
                "round": 2,
                "completed": True,
                "first_text_seconds": None,
                "final_after_audio_seconds": 0.8,
                "max_sender_lag_seconds": 0.01,
            },
        ]
        report = summarize([rows[0], rows[2], rows[1]], 5)
        self.assertEqual((report["completed"], report["failed"]), (2, 1))
        self.assertEqual(report["final_after_audio_seconds"]["p95"], 0.8)
        self.assertEqual(report["early_final_p95"], 0.3)
        self.assertEqual(report["late_final_p95"], 0.8)
        self.assertIsNone(percentile([], 0.95))

    def test_pacing_does_not_wait_for_transcription(self):
        async def scenario():
            commits = []

            async def server(ws):
                await ws.send(
                    json.dumps(
                        {
                            "type": "session.created",
                            "session": {
                                "audio": {"input": {"transcription": {"model": "test", "language": "auto"}}}
                            },
                        }
                    )
                )
                update = json.loads(await ws.recv())
                self.assertEqual(update["session"]["audio"]["input"]["transcription"]["language"], "auto")
                await ws.send(json.dumps({"type": "session.updated"}))
                async for raw in ws:
                    event_type = json.loads(raw)["type"]
                    if event_type == "input_audio_buffer.commit":
                        commits.append(event_type)
                        index = len(commits)
                        await ws.send(
                            json.dumps({"type": "input_audio_buffer.committed", "item_id": str(index)})
                        )
                        if index == 3:
                            # No final is sent until all commits arrive. A sender that
                            # waits for transcription will time out instead of completing.
                            for item in range(1, 4):
                                await ws.send(
                                    json.dumps(
                                        {
                                            "type": "conversation.item.input_audio_transcription.completed",
                                            "item_id": str(item),
                                            "transcript": "hello",
                                        }
                                    )
                                )

            async with serve(server, "127.0.0.1", 0) as listener:
                port = listener.sockets[0].getsockname()[1]
                # A 20 ms clip repeated with a 20 ms gap.
                rows = await run_stream(
                    f"ws://127.0.0.1:{port}/v1/realtime", "key", b"\0" * 960, 0, 3, 0.02, 3, time.monotonic()
                )
            return rows, commits

        rows, commits = asyncio.run(scenario())
        self.assertTrue(all(row["completed"] for row in rows), rows)
        self.assertEqual(len(commits), 3)

    def test_empty_final_is_not_success(self):
        async def scenario():
            async def server(ws):
                await ws.send(
                    json.dumps(
                        {
                            "type": "session.created",
                            "session": {
                                "audio": {"input": {"transcription": {"model": "test", "language": "auto"}}}
                            },
                        }
                    )
                )
                await ws.recv()
                await ws.send(json.dumps({"type": "session.updated"}))
                async for raw in ws:
                    if json.loads(raw)["type"] == "input_audio_buffer.commit":
                        await ws.send(json.dumps({"type": "input_audio_buffer.committed", "item_id": "one"}))
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "conversation.item.input_audio_transcription.completed",
                                    "item_id": "one",
                                    "transcript": "",
                                }
                            )
                        )

            async with serve(server, "127.0.0.1", 0) as listener:
                port = listener.sockets[0].getsockname()[1]
                return await run_stream(
                    f"ws://127.0.0.1:{port}/v1/realtime", "key", b"\0" * 960, 0, 1, 0, 3, time.monotonic()
                )

        row = asyncio.run(scenario())[0]
        self.assertFalse(row["completed"])
        self.assertIn("Empty final", row["error"])

    def test_final_delta_after_commit_is_not_interim(self):
        async def scenario():
            async def server(ws):
                await ws.send(
                    json.dumps(
                        {
                            "type": "session.created",
                            "session": {
                                "audio": {"input": {"transcription": {"model": "test", "language": "auto"}}}
                            },
                        }
                    )
                )
                await ws.recv()
                await ws.send(json.dumps({"type": "session.updated"}))
                async for raw in ws:
                    if json.loads(raw)["type"] == "input_audio_buffer.commit":
                        await ws.send(json.dumps({"type": "input_audio_buffer.committed", "item_id": "one"}))
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "conversation.item.input_audio_transcription.delta",
                                    "item_id": "one",
                                    "delta": "final text",
                                }
                            )
                        )
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "conversation.item.input_audio_transcription.completed",
                                    "item_id": "one",
                                    "transcript": "final text",
                                }
                            )
                        )

            async with serve(server, "127.0.0.1", 0) as listener:
                port = listener.sockets[0].getsockname()[1]
                return await run_stream(
                    f"ws://127.0.0.1:{port}/v1/realtime", "key", b"\0" * 960, 0, 1, 0, 3, time.monotonic()
                )

        rows = asyncio.run(scenario())
        self.assertTrue(rows[0]["completed"], rows)
        self.assertIsNone(rows[0]["first_text_seconds"])
        self.assertEqual(summarize(rows, 1)["completed_without_interim"], 1)

    def test_queued_interim_before_commit_ack_is_counted(self):
        async def scenario():
            async def server(ws):
                await ws.send(
                    json.dumps(
                        {
                            "type": "session.created",
                            "session": {
                                "audio": {"input": {"transcription": {"model": "test", "language": "auto"}}}
                            },
                        }
                    )
                )
                await ws.recv()
                await ws.send(json.dumps({"type": "session.updated"}))
                async for raw in ws:
                    if json.loads(raw)["type"] == "input_audio_buffer.commit":
                        # An interim response can still be queued when the sender commits.
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "conversation.item.input_audio_transcription.delta",
                                    "item_id": "one",
                                    "delta": "interim",
                                }
                            )
                        )
                        await ws.send(json.dumps({"type": "input_audio_buffer.committed", "item_id": "one"}))
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "conversation.item.input_audio_transcription.completed",
                                    "item_id": "one",
                                    "transcript": "final text",
                                }
                            )
                        )

            async with serve(server, "127.0.0.1", 0) as listener:
                port = listener.sockets[0].getsockname()[1]
                return await run_stream(
                    f"ws://127.0.0.1:{port}/v1/realtime", "key", b"\0" * 960, 0, 1, 0, 3, time.monotonic()
                )

        rows = asyncio.run(scenario())
        self.assertTrue(rows[0]["completed"], rows)
        self.assertIsNotNone(rows[0]["first_text_seconds"])
        self.assertEqual(summarize(rows, 1)["completed_without_interim"], 0)


if __name__ == "__main__":
    unittest.main()
