import asyncio
import json
import tempfile
import time
import unittest
import wave
from pathlib import Path

from stt_load import percentile, read_pcm, run_stream, summarize
from websockets.asyncio.server import serve


class LoadTest(unittest.TestCase):
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
                async def finish(index):
                    await asyncio.sleep(0.15 * index)
                    await ws.send(
                        json.dumps(
                            {
                                "type": "conversation.item.input_audio_transcription.delta",
                                "item_id": str(index),
                                "delta": "hello",
                            }
                        )
                    )
                    await ws.send(
                        json.dumps(
                            {
                                "type": "conversation.item.input_audio_transcription.completed",
                                "item_id": str(index),
                                "transcript": "hello",
                            }
                        )
                    )

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
                pending = []
                interim_for = 0
                async for raw in ws:
                    event_type = json.loads(raw)["type"]
                    if event_type == "input_audio_buffer.append" and interim_for == len(commits):
                        interim_for += 1
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "conversation.item.input_audio_transcription.delta",
                                    "item_id": str(interim_for),
                                    "delta": "early",
                                }
                            )
                        )
                    if event_type == "input_audio_buffer.commit":
                        commits.append(time.monotonic())
                        index = len(commits)
                        await ws.send(
                            json.dumps({"type": "input_audio_buffer.committed", "item_id": str(index)})
                        )
                        pending.append(asyncio.create_task(finish(index)))
                await asyncio.gather(*pending)

            async with serve(server, "127.0.0.1", 0) as listener:
                port = listener.sockets[0].getsockname()[1]
                # A 20 ms clip repeated with a 20 ms gap; inference takes 150 ms.
                rows = await run_stream(
                    f"ws://127.0.0.1:{port}/v1/realtime", "key", b"\0" * 960, 0, 3, 0.02, 3, time.monotonic()
                )
            return rows, commits

        rows, commits = asyncio.run(scenario())
        self.assertTrue(all(row["completed"] for row in rows), rows)
        self.assertLess(commits[-1] - commits[0], 0.2)
        self.assertLess(rows[0]["first_text_seconds"], 0.1)
        self.assertGreater(rows[-1]["final_after_audio_seconds"], rows[0]["final_after_audio_seconds"])

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


if __name__ == "__main__":
    unittest.main()
