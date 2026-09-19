import asyncio
import threading
import unittest

from runtime import AuthenticatedBodyLimitMiddleware, run_in_thread_serialized


class SerializedThreadTest(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_does_not_release_lock_while_thread_runs(self):
        second_waiting = asyncio.Event()

        class TrackedSemaphore(asyncio.Semaphore):
            acquisitions = 0

            async def acquire(self):
                self.acquisitions += 1
                if self.acquisitions == 2:
                    second_waiting.set()
                return await super().acquire()

        lock = TrackedSemaphore(1)
        first_started = threading.Event()
        release_first = threading.Event()
        first_finished = threading.Event()
        second_started = threading.Event()
        order = []

        def first():
            order.append("first started")
            first_started.set()
            release_first.wait()
            order.append("first finished")
            first_finished.set()

        def second():
            order.append("second started")
            second_started.set()

        first_task = asyncio.create_task(run_in_thread_serialized(lock, first))
        self.assertTrue(await asyncio.to_thread(first_started.wait, 1))
        for _ in range(3):
            first_task.cancel()
        second_task = asyncio.create_task(run_in_thread_serialized(lock, second))
        try:
            await asyncio.wait_for(second_waiting.wait(), timeout=1)
            self.assertFalse(first_finished.is_set())
            self.assertFalse(second_started.is_set())
        finally:
            release_first.set()
            results = await asyncio.wait_for(
                asyncio.gather(first_task, second_task, return_exceptions=True), timeout=1
            )

        self.assertIsInstance(results[0], asyncio.CancelledError)
        self.assertIsNone(results[1])
        self.assertEqual(order, ["first started", "first finished", "second started"])

    async def invoke_body_limit(self, headers, chunks):
        received = 0
        reads = 0

        async def app(_scope, receive, send):
            nonlocal received
            while message := await receive():
                received += len(message.get("body", b""))
                if not message.get("more_body"):
                    break
            await send({"type": "http.response.start", "status": 204, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        middleware = AuthenticatedBodyLimitMiddleware(
            app, "/upload", 5, lambda value: value == "Bearer secret"
        )
        messages = iter(chunks)
        sent = []

        async def receive():
            nonlocal reads
            reads += 1
            return next(messages)

        async def send(message):
            sent.append(message)

        await middleware({"type": "http", "path": "/upload", "headers": headers}, receive, send)
        return sent[0]["status"], received, reads

    async def test_body_limit_authenticates_before_reading(self):
        status, received, reads = await self.invoke_body_limit([], [])
        self.assertEqual(status, 401)
        self.assertEqual(received, 0)
        self.assertEqual(reads, 0)

    async def test_body_limit_rejects_oversize_and_invalid_content_length_without_reading(self):
        auth = [(b"authorization", b"Bearer secret")]
        for content_length, expected_status in ((b"6", 413), (b"invalid", 400)):
            with self.subTest(content_length=content_length):
                status, received, reads = await self.invoke_body_limit(
                    [*auth, (b"content-length", content_length)], []
                )
                self.assertEqual(status, expected_status)
                self.assertEqual(received, 0)
                self.assertEqual(reads, 0)

    async def test_body_limit_counts_chunks_and_replays_accepted_body(self):
        auth = [(b"authorization", b"Bearer secret")]
        accepted = [{"type": "http.request", "body": b"1234", "more_body": False}]
        status, received, reads = await self.invoke_body_limit(auth, accepted)
        self.assertEqual(status, 204)
        self.assertEqual(received, 4)
        self.assertEqual(reads, 1)

        chunks = [
            {"type": "http.request", "body": b"123", "more_body": True},
            {"type": "http.request", "body": b"456", "more_body": False},
        ]
        status, received, reads = await self.invoke_body_limit(auth, chunks)
        self.assertEqual(status, 413)
        self.assertEqual(received, 0)
        self.assertEqual(reads, 2)


if __name__ == "__main__":
    unittest.main()
