import asyncio
from collections.abc import Callable
from typing import Any


class StreamCapacity:
    """Admit no more than one replica's configured number of Realtime streams."""

    def __init__(self, limit: int):
        self.limit = limit
        self.active = 0

    def acquire(self) -> bool:
        if self.active >= self.limit:
            return False
        self.active += 1
        return True

    def release(self) -> None:
        self.active -= 1


async def run_in_thread_serialized(
    lock: asyncio.Semaphore,
    operation: Callable[..., Any],
    *args: Any,
) -> Any:
    """Keep the lock until thread work stops, even if the caller is cancelled."""
    async with lock:
        worker = asyncio.create_task(asyncio.to_thread(operation, *args))
        cancelled = False
        while not worker.done():
            try:
                await asyncio.shield(worker)
            except asyncio.CancelledError:
                cancelled = True
            except Exception:
                if not cancelled:
                    raise
        if cancelled:
            worker.exception()
            raise asyncio.CancelledError
        return worker.result()
