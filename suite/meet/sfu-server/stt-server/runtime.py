import asyncio
from collections.abc import Callable
from typing import Any


class AuthenticatedBodyLimitMiddleware:
    def __init__(self, app, path: str, max_bytes: int, authorize: Callable[[str | None], bool]):
        self.app = app
        self.path = path
        self.max_bytes = max_bytes
        self.authorize = authorize

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != self.path:
            return await self.app(scope, receive, send)

        headers = dict(scope["headers"])
        authorization = headers.get(b"authorization")
        if not self.authorize(authorization.decode("latin1") if authorization else None):
            return await self._respond(send, 401, b'{"detail":"Unauthorized"}')

        content_length = headers.get(b"content-length")
        if content_length:
            try:
                if int(content_length) > self.max_bytes:
                    return await self._respond(send, 413, b'{"detail":"Audio upload is too large"}')
            except ValueError:
                return await self._respond(send, 400, b'{"detail":"Invalid Content-Length"}')

        received = 0
        messages = []
        while True:
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    return await self._respond(send, 413, b'{"detail":"Audio upload is too large"}')
                messages.append(message)
                if not message.get("more_body"):
                    break
            elif message["type"] == "http.disconnect":
                return

        pending = iter(messages)

        async def replay():
            return next(pending, {"type": "http.disconnect"})

        return await self.app(scope, replay, send)

    @staticmethod
    async def _respond(send, status: int, body: bytes):
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"application/json")]
                + ([(b"www-authenticate", b"Bearer")] if status == 401 else []),
            }
        )
        await send({"type": "http.response.body", "body": body})


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
