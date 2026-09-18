import asyncio
from typing import Optional
from utils.logger import StructuredLogger

logger = StructuredLogger("PendingTasksHelper")

# Registry to hold event and response for active client automation calls
# Key: conversation_id (string) or f"{conversation_id}_{task_token}"
# Value: dict with "event": asyncio.Event, "response": dict
PENDING_TASKS = {}
LAST_TOOL_START_TOKENS = {}

# Cross-worker fallback (wayfinder T8): PENDING_TASKS above is process-local,
# so a response POST landing on a different worker would 404. The wait side
# registers a `waiting` row in the pending_client_mailbox table and polls it;
# the response side marks the row `responded` when no local entry exists.
# Single-worker behaviour is unchanged (in-memory event fast path first).
#
# COORDINATION CHOICE: DB polling, not Redis. Rationale: no Redis infra
# exists in this repo and the ticket forbids new infra without a flag-guard
# + local fallback; the mailbox table is created by the idempotent
# ensure_prod_schema guard, so it works on a clean DB with zero new
# services. Sticky-affinity is NOT required: any worker accepts the
# response (200) and the waiting worker picks it up via polling.
# LAST_TOOL_START_TOKENS stays process-local by design: it hands a token
# from on_tool_start to the tool running in the SAME graph execution on the
# SAME worker — it never crosses a worker boundary, so only the response
# routing (this mailbox) needs sharing.
MAILBOX_STALE_SECONDS = 15 * 60
MAILBOX_POLL_INTERVAL = 0.5


def _mailbox_session():
    """Lazy import to keep module import light (avoids import cycles)."""
    from db.session import get_db_session
    return get_db_session()


def _prune_stale_mailbox_rows(session, now=None) -> None:
    """Best-effort delete of mailbox rows older than MAILBOX_STALE_SECONDS."""
    try:
        from db.models import PendingClientMailbox, utcnow_naive
        from datetime import timedelta
        cutoff = utcnow_naive() - timedelta(seconds=MAILBOX_STALE_SECONDS)
        session.query(PendingClientMailbox).filter(
            PendingClientMailbox.created_at < cutoff
        ).delete(synchronize_session=False)
    except Exception:
        pass


def register_mailbox_waiter(key: str, conversation_id: str) -> None:
    """Record a `waiting` mailbox row. Never raises (local fallback)."""
    try:
        from db.models import PendingClientMailbox
        with _mailbox_session() as session:
            _prune_stale_mailbox_rows(session)
            existing = session.query(PendingClientMailbox).filter_by(key=key).first()
            if existing is None:
                session.add(PendingClientMailbox(
                    key=key,
                    conversation_id=conversation_id,
                    state="waiting",
                    status=None,
                    result=None,
                ))
            elif existing.state != "responded":
                # Only reset when no response has arrived yet: a response
                # POST processed just before this registration must survive
                # so the poll loop below picks it up immediately.
                existing.conversation_id = conversation_id
                existing.state = "waiting"
                existing.status = None
                existing.result = None
    except Exception as e:
        logger.error("Mailbox waiter register failed (local-only fallback)", error=str(e))


def poll_mailbox_response(key: str):
    """Return (status, result) if a cross-worker response arrived, else None."""
    try:
        from db.models import PendingClientMailbox
        with _mailbox_session() as session:
            row = session.query(PendingClientMailbox).filter_by(
                key=key, state="responded"
            ).first()
            if row is None:
                return None
            status = row.status or "error"
            result = row.result or ""
            session.delete(row)
            return status, result
    except Exception:
        return None


def remove_mailbox_waiter(key: str) -> None:
    """Best-effort cleanup of our waiter row (timeout / done paths)."""
    try:
        from db.models import PendingClientMailbox
        with _mailbox_session() as session:
            session.query(PendingClientMailbox).filter_by(key=key).delete(
                synchronize_session=False
            )
    except Exception:
        pass


def submit_cross_worker_response(
    conversation_id: str,
    status: str,
    result: str,
    task_token: Optional[str] = None,
):
    """Resolve a client response, checking local memory first then the mailbox.

    Returns the registry/mailbox key that accepted the response, or None
    when no waiter exists anywhere (caller should 404).
    """
    # 1. Local fast path: exact, token-suffixed, then prefix match.
    if task_token:
        possible_key = f"{conversation_id}_{task_token}"
        if possible_key in PENDING_TASKS:
            PENDING_TASKS[possible_key]["response"] = {"status": status, "result": result}
            return possible_key
    if conversation_id in PENDING_TASKS:
        PENDING_TASKS[conversation_id]["response"] = {"status": status, "result": result}
        return conversation_id
    for k in PENDING_TASKS.keys():
        if k.startswith(f"{conversation_id}_"):
            PENDING_TASKS[k]["response"] = {"status": status, "result": result}
            return k

    # 2. Cross-worker fallback: a waiter row on another worker's behalf.
    try:
        from db.models import PendingClientMailbox, utcnow_naive
        with _mailbox_session() as session:
            _prune_stale_mailbox_rows(session)
            row = None
            if task_token:
                row = session.query(PendingClientMailbox).filter_by(
                    key=f"{conversation_id}_{task_token}", state="waiting"
                ).first()
            if row is None:
                row = session.query(PendingClientMailbox).filter_by(
                    key=conversation_id, state="waiting"
                ).first()
            if row is None:
                row = (
                    session.query(PendingClientMailbox)
                    .filter(
                        PendingClientMailbox.conversation_id == conversation_id,
                        PendingClientMailbox.state == "waiting",
                    )
                    .order_by(PendingClientMailbox.created_at.asc())
                    .first()
                )
            if row is None:
                return None
            row.state = "responded"
            row.status = status
            row.result = result
            row.updated_at = utcnow_naive()
            return row.key
    except Exception as e:
        logger.error("Mailbox cross-worker submit failed", error=str(e))
        return None


async def wait_for_client_event(
    conversation_id: str,
    action: Optional[str] = None,
    target: Optional[str] = None,
    value: Optional[str] = None,
    task_token: Optional[str] = None,
    timeout: float = 60.0,
    timeout_message: str = "Timeout waiting for client response."
):
    """Blocks execution and awaits an event response from the mobile client."""
    event = asyncio.Event()
    loop = asyncio.get_running_loop()
    key = f"{conversation_id}_{task_token}" if task_token else conversation_id

    PENDING_TASKS[key] = {
        "event": event,
        "loop": loop,
        "response": None
    }
    # Cross-worker fallback: let a response landing on another worker find us.
    await asyncio.to_thread(register_mailbox_waiter, key, conversation_id)

    status = "error"
    result = ""
    try:
        # Wait in short slices so a cross-worker mailbox response (polled
        # off the event loop via to_thread) can wake us even though our
        # local asyncio.Event will never be set by the other worker.
        deadline = loop.time() + timeout
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                status = "timeout"
                result = timeout_message
                break
            try:
                await asyncio.wait_for(event.wait(), timeout=min(MAILBOX_POLL_INTERVAL, remaining))
            except asyncio.TimeoutError:
                pass
            task_data = PENDING_TASKS.get(key)
            if task_data and task_data["response"]:
                resp = task_data["response"]
                status = resp.get("status", "error")
                result = resp.get("result", "")
                break
            if event.is_set():
                # Event set but entry already cleaned (shouldn't happen);
                # treat as no-response rather than hanging.
                result = "No response received from client."
                break
            # Local event not set — check for a cross-worker mailbox reply.
            mailbox_hit = await asyncio.to_thread(poll_mailbox_response, key)
            if mailbox_hit is not None:
                status, result = mailbox_hit
                break
            if loop.time() >= deadline:
                status = "timeout"
                result = timeout_message
                break
    except asyncio.TimeoutError:
        status = "timeout"
        result = timeout_message
    finally:
        PENDING_TASKS.pop(key, None)
        await asyncio.to_thread(remove_mailbox_waiter, key)

    return status, result
