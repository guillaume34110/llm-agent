"""Persistent asyncio event loop running in a background thread.

Browser tools must NOT call asyncio.run() per invocation: it kills the loop,
which kills the singleton browser's locks/contexts. Instead, every coroutine
is scheduled on this single long-lived loop.
"""
import asyncio
import threading
from concurrent.futures import Future

_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_lock = threading.Lock()


def _runner(loop: asyncio.AbstractEventLoop):
    asyncio.set_event_loop(loop)
    loop.run_forever()


def get_loop() -> asyncio.AbstractEventLoop:
    global _loop, _thread
    with _lock:
        if _loop and not _loop.is_closed():
            return _loop
        _loop = asyncio.new_event_loop()
        _thread = threading.Thread(target=_runner, args=(_loop,), daemon=True, name="monkey-browser-loop")
        _thread.start()
        return _loop


def run(coro, timeout: float | None = 120) -> any:
    """Schedule coroutine on persistent loop, block until result."""
    loop = get_loop()
    fut: Future = asyncio.run_coroutine_threadsafe(coro, loop)
    return fut.result(timeout=timeout)


def shutdown():
    global _loop, _thread
    with _lock:
        if _loop and not _loop.is_closed():
            _loop.call_soon_threadsafe(_loop.stop)
        _loop = None
        _thread = None
