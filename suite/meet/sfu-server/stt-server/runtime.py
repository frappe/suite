import asyncio
from collections.abc import Callable
from typing import Any


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
