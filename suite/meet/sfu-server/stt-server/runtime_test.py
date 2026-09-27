import asyncio
import threading
import unittest

from runtime import StreamCapacity, run_in_thread_serialized


class StreamCapacityTest(unittest.TestCase):
    def test_rejects_excess_streams_and_releases_capacity(self):
        capacity = StreamCapacity(2)
        self.assertTrue(capacity.acquire())
        self.assertTrue(capacity.acquire())
        self.assertFalse(capacity.acquire())
        capacity.release()
        self.assertTrue(capacity.acquire())


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


if __name__ == "__main__":
    unittest.main()
