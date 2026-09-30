import asyncio
import base64
import importlib.util
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from stt_accuracy import (
    load_manifest,
    main,
    make_report,
    name_counts,
    score_clip,
    transcribe,
    word_errors,
    words,
    write_private,
)
from websockets.asyncio.server import serve


def clip(**changes):
    return {
        "id": "clip-01",
        "audio": "clip.wav",
        "accent": "indian-english",
        "language": "en-US",
        "scenario": "english-only",
        "consented": True,
        "reference": "Siobhan, send the report to Aarav.",
        "names": ["Siobhan", "Aarav"],
        "speech_end_seconds": 0.12,
        **changes,
    }


class AccuracyTest(unittest.TestCase):
    def test_missing_report_directory_is_rejected_before_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            arguments = [
                "stt_accuracy.py",
                "--manifest",
                "unused.json",
                "--url",
                "http://unused",
                "--label",
                "test",
                "--output",
                str(Path(directory) / "missing" / "report.json"),
            ]
            with patch("sys.argv", arguments), patch("sys.stderr"), patch("stt_accuracy.replay") as replay:
                with self.assertRaises(SystemExit) as error:
                    main()
            self.assertEqual(error.exception.code, 2)
            replay.assert_not_called()

    @unittest.skipUnless(importlib.util.find_spec("voi_oiwer"), "Optional OIWER dependency")
    def test_lattice_accepts_variants_but_keeps_strict_script_errors(self):
        item = clip(
            reference="मेरा नाम सुहैल है",
            names=[],
            reference_lattice=[["मेरा"], ["नाम"], ["सुहैल", "suhail"], ["है"]],
            oiwer_language="hindi",
        )
        report = make_report([item], {item["id"]: {"transcript": "मेरा नाम suhail है"}}, "test", None)
        self.assertEqual(report["summary"]["word_errors"], 1)
        self.assertEqual(report["summary"]["oiwer"]["rate"], 0)
        wrong = score_clip(item, {"transcript": "मेरा नाम गलत है"})
        self.assertEqual(wrong["oiwer_word_errors"], 1)
        self.assertEqual(wrong["oiwer_reference_words"], 4)
        empty = score_clip(item, {"transcript": ""})
        self.assertEqual(empty["oiwer_word_errors"], 4)
        self.assertTrue(empty["failed"])

    @unittest.skipUnless(importlib.util.find_spec("voi_oiwer"), "Optional OIWER dependency")
    def test_phrase_variants_use_aligned_word_counts_and_separate_coverage(self):
        item = clip(
            reference="बातचीत करो",
            names=[],
            reference_lattice=[["बातचीत", "बात चीत"], ["करो"]],
            oiwer_language="hindi",
        )
        other = clip(id="english", reference="hello there", names=[])
        report = make_report(
            [item, other],
            {item["id"]: {"transcript": "बात चीत करो"}, "english": {"transcript": "wrong"}},
            "test",
            None,
        )
        metric = report["summary"]["oiwer"]
        self.assertEqual(metric["clips"], 1)
        self.assertEqual(metric["reference_words"], 3)
        self.assertEqual(metric["word_errors"], 0)
        self.assertGreater(report["summary"]["word_errors"], 0)

    def test_lattice_manifest_rejects_empty_or_invalid_variants(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            for lattice in ([], [[]], [[""]], [[42]], "not-a-lattice"):
                path.write_text(
                    json.dumps(
                        {"version": 1, "clips": [clip(reference_lattice=lattice, oiwer_language="hindi")]}
                    )
                )
                with self.assertRaises(ValueError):
                    load_manifest(path)

    def test_word_errors_against_hand_counted_edits(self):
        self.assertEqual(word_errors(words("send report to aarav"), words("please send file to")), 3)
        self.assertEqual(word_errors(words("one two"), []), 2)
        self.assertEqual(word_errors([], words("one two")), 2)
        self.assertEqual(words("HELLO, O\u2019Neil! नमस्ते"), ["hello", "o'neil", "नमस्ते"])

    def test_name_errors_and_false_insertions(self):
        row = score_clip(clip(), {"transcript": "Siobhan send the report to Zubair"})
        self.assertEqual(row["expected_name_mentions"], 2)
        self.assertEqual(row["correct_name_mentions"], 1)
        row = score_clip(
            clip(names=["Siobhan", "Aarav", "Zubair"]),
            {"transcript": "Siobhan send the report to Zubair Zubair"},
        )
        self.assertEqual(row["false_name_mentions"], 2)
        self.assertEqual(row["word_errors"], 2)

    def test_names_are_word_bounded_and_longest_match(self):
        self.assertEqual(
            name_counts(words("Joanne Jo Singh Jo"), ["Jo", "Jo Singh"]), {"Jo Singh": 1, "Jo": 1}
        )

    def test_false_names_in_negative_control_and_script_mismatch(self):
        report = make_report(
            [clip(reference="Please send the report")],
            {"clip-01": {"transcript": "प्लीज Siobhan"}},
            "auto",
            None,
        )
        self.assertEqual(report["summary"]["false_name_mentions"], 1)
        self.assertIsNone(report["summary"]["name_recall"])
        self.assertEqual(report["summary"]["reference_without_devanagari_clips_with_devanagari"], 1)
        mixed = score_clip(clip(reference="Aarav, रिपोर्ट भेजो"), {"transcript": "Aarav, रिपोर्ट भेजो"})
        self.assertIsNone(mixed["unexpected_devanagari_letters"])
        self.assertEqual(mixed["word_errors"], 0)

    def test_failed_and_missing_clips_cannot_improve_accuracy(self):
        report = make_report([clip()], {"clip-01": {"transcript": "", "failed": True}}, "failed", None)
        self.assertEqual(report["summary"]["wer"], 1)
        self.assertEqual(report["summary"]["name_recall"], 0)
        self.assertEqual(report["summary"]["failed"], 1)
        with self.assertRaises(ValueError):
            make_report([clip()], {}, "missing", None)
        self.assertTrue(score_clip(clip(), {"transcript": ""})["failed"])
        with self.assertRaises(ValueError):
            score_clip(clip(), {"transcript": "text", "failed": "false"})

    def test_latency_rejects_nonfinite_values_and_empty_reference_keeps_insertions(self):
        with self.assertRaises(ValueError):
            score_clip(clip(), {"transcript": "text", "first_text_seconds": float("nan")})
        report = make_report(
            [clip(reference="")], {"clip-01": {"transcript": "unexpected text"}}, "silence", None
        )
        self.assertIsNone(report["summary"]["wer"])
        self.assertEqual(report["summary"]["word_errors"], 2)

    def test_reports_aggregate_word_counts_and_omit_private_content(self):
        clips = [
            clip(reference="Siobhan"),
            clip(id="clip-02", accent="british-english", reference="one two three"),
        ]
        report = make_report(
            clips,
            {"clip-01": {"transcript": "wrong"}, "clip-02": {"transcript": "one two three"}},
            "baseline",
            "sha256:test",
        )
        self.assertEqual(report["summary"]["wer"], 0.25)
        self.assertEqual(report["by_accent"]["indian-english"]["wer"], 1)
        serialized = json.dumps(report)
        for private in ("Siobhan", "Aarav", "one two three", "clip.wav"):
            self.assertNotIn(private, serialized)

    def test_manifest_requires_consent_and_distinct_clip_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            for entries in (
                [clip(consented=False)],
                [clip(), clip()],
                [clip(names=["Jo", "JO!"])],
                [clip(speech_end_seconds=-1)],
            ):
                path.write_text(json.dumps({"version": 1, "clips": entries}))
                with self.assertRaises(ValueError):
                    load_manifest(path)
            path.write_text(json.dumps({"version": 1, "clips": [clip()]}))
            self.assertEqual(load_manifest(path)[0]["audio_path"], Path(directory) / "clip.wav")
            path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "clips": [
                            clip(
                                consented=False,
                                dataset_license="CC-BY-SA-4.0",
                                source_url="https://www.openslr.org/104/",
                                speech_end_seconds=None,
                            )
                        ],
                    }
                )
            )
            self.assertIsNone(load_manifest(path)[0]["speech_end_seconds"])

    def test_export_permissions_even_for_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.touch(mode=0o644)
            write_private(path, {"summary": "test"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_realtime_protocol_pacing_and_language_override(self):
        async def scenario(final_only=False, empty=False, failure=False, hints=True):
            received = {}

            async def handler(ws):
                received["authorization"] = ws.request.headers["Authorization"]
                await ws.send(
                    json.dumps(
                        {
                            "type": "session.created",
                            "session": {"audio": {"input": {"transcription": {"model": "fake"}}}},
                        }
                    )
                )
                update = json.loads(await ws.recv())
                received["settings"] = update["session"]["audio"]["input"]["transcription"]
                await ws.send(json.dumps({"type": "session.updated"}))
                frames = []
                start = time.monotonic()
                async for raw in ws:
                    event = json.loads(raw)
                    if event["type"] == "input_audio_buffer.append":
                        frames.append(base64.b64decode(event["audio"]))
                        if len(frames) == 1 and not final_only:
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "conversation.item.input_audio_transcription.delta",
                                        "delta": "Siobhan",
                                    }
                                )
                            )
                    elif event["type"] == "input_audio_buffer.commit":
                        received["pcm"] = b"".join(frames)
                        received["sizes"] = list(map(len, frames))
                        received["elapsed"] = time.monotonic() - start
                        await ws.send(json.dumps({"type": "input_audio_buffer.committed", "item_id": "one"}))
                        if final_only:
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "conversation.item.input_audio_transcription.delta",
                                        "delta": "Siobhan",
                                    }
                                )
                            )
                        if failure:
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "conversation.item.input_audio_transcription.failed",
                                        "error": "PRIVATE server error",
                                    }
                                )
                            )
                        else:
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "conversation.item.input_audio_transcription.completed",
                                        "transcript": "" if empty else "Siobhan",
                                    }
                                )
                            )

            async with serve(handler, "127.0.0.1", 0) as server:
                port = server.sockets[0].getsockname()[1]
                result = await transcribe(
                    f"ws://127.0.0.1:{port}", "test-key", clip(), bytes(11520), hints, 3, "auto"
                )
            return result, received

        result, received = asyncio.run(scenario())
        self.assertFalse(result["failed"])
        self.assertEqual(result["transcript"], "Siobhan")
        self.assertEqual(received["settings"]["language"], "auto")
        self.assertEqual(received["settings"]["names"], ["Siobhan", "Aarav"])
        self.assertEqual(received["authorization"], "Bearer test-key")
        self.assertEqual(received["pcm"], bytes(11520))
        self.assertEqual(received["sizes"], [4800, 4800, 1920])
        self.assertGreaterEqual(received["elapsed"], 0.22)
        self.assertIsNotNone(result["first_text_seconds"])
        self.assertGreaterEqual(result["final_after_speech_seconds"], 0.10)
        result, received = asyncio.run(scenario(final_only=True, hints=False))
        self.assertIsNone(result["first_text_seconds"])
        self.assertNotIn("names", received["settings"])
        result, _ = asyncio.run(scenario(empty=True))
        self.assertTrue(result["failed"])
        result, _ = asyncio.run(scenario(failure=True))
        self.assertTrue(result["failed"])
        self.assertNotIn("PRIVATE", json.dumps(result))

    def test_protocol_timeout_is_reported_without_hanging(self):
        async def scenario():
            async def handler(ws):
                await ws.wait_closed()

            async with serve(handler, "127.0.0.1", 0) as server:
                port = server.sockets[0].getsockname()[1]
                return await transcribe(f"ws://127.0.0.1:{port}", "test-key", clip(), bytes(4800), True, 0.1)

        result = asyncio.run(scenario())
        self.assertTrue(result["failed"])
        self.assertEqual(result["error_type"], "TimeoutError")


if __name__ == "__main__":
    unittest.main()
