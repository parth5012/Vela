import os
import asyncio
from utils.logger import StructuredLogger

logger = StructuredLogger("Concurrency")

_semaphore = None

def get_stream_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        limit_str = os.getenv("MAX_CONCURRENT_STREAMS", "2")
        try:
            limit = int(limit_str)
        except ValueError:
            limit = 2
        clamped_limit = min(max(limit, 1), 4)
        _semaphore = asyncio.Semaphore(clamped_limit)
        logger.info("Initialized streams semaphore", limit=clamped_limit)
    return _semaphore
