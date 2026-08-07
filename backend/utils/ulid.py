import time
import random

CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def generate_ulid() -> str:
    """Generates a standard-compliant, sortable Crockford Base32 ULID string."""
    # 48-bit timestamp in milliseconds
    timestamp_ms = int(time.time() * 1000)
    
    # encode timestamp (10 characters)
    ts_chars = []
    val = timestamp_ms
    for _ in range(10):
        ts_chars.append(CROCKFORD_BASE32[val % 32])
        val //= 32
    ts_str = "".join(reversed(ts_chars))
    
    # encode 80-bit randomness (16 characters)
    rand_chars = []
    for _ in range(16):
        rand_chars.append(random.choice(CROCKFORD_BASE32))
    rand_str = "".join(rand_chars)
    
    return ts_str + rand_str
