#!/usr/bin/env python3
"""
One-off FCM test push helper — reads the registered device token from
system_settings and calls tools.notify.send_push.

Usage (from backend/):
    uv run python scripts/test_fcm_push.py
    uv run python scripts/test_fcm_push.py --title "Hello" --body "Body" --type briefing
    uv run python scripts/test_fcm_push.py --conversation-id <uuid> --type calendar_reminder
    uv run python scripts/test_fcm_push.py --token <explicit-fcm-token>   # bypass DB lookup

Requires:
    - DATABASE_URL set (so _get_token can read system_settings.fcm_device_token)
    - FCM_SERVICE_ACCOUNT_JSON set (so firebase_admin can init and send)
    - Token already registered via POST /api/config/device-token (normally done by dev-client on setup)

Exit codes:
    0 = push sent (send_push returned True)
    1 = skipped/failed (no token, no creds, or send error — see logs)
    2 = usage / environment error
"""

from __future__ import annotations

import argparse
import os
import sys

# Ensure backend/ is on sys.path when run as `python scripts/test_fcm_push.py`
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Send a test FCM push via tools.notify.send_push")
    p.add_argument("--title", default="Vela Test", help='Notification title (default: "Vela Test")')
    p.add_argument("--body", default="Test notification from backend/tools/notify.py", help="Notification body")
    p.add_argument(
        "--type",
        dest="msg_type",
        default="task_completion",
        choices=["task_completion", "calendar_reminder", "briefing", "checkin", "generic"],
        help="data.type value (default: task_completion)",
    )
    p.add_argument(
        "--conversation-id",
        default="test-123",
        help="data.conversation_id value (default: test-123; use '' to omit)",
    )
    p.add_argument("--token", default=None, help="Explicit FCM token (bypass DB lookup)")
    p.add_argument("--channel-id", default=None, help="Explicit Android channel_id override (rare)")
    p.add_argument("--dry-run", action="store_true", help="Print what would be sent without calling FCM")
    return p.parse_args()


def _read_token_from_db() -> str | None:
    """Read fcm_device_token from system_settings via DBClient."""
    try:
        from db.session import get_db_session
        from db.client import DBClient
    except Exception as e:
        print(f"[error] Failed to import DB layer: {e}", file=sys.stderr)
        return None
    try:
        with get_db_session() as session:
            client = DBClient(session)
            token = client.get_system_setting("fcm_device_token")
            return token
    except Exception as e:
        print(f"[error] Failed to read fcm_device_token from DB: {e}", file=sys.stderr)
        return None


def main() -> int:
    args = _parse_args()

    # Resolve token
    if args.token:
        token = args.token
        print(f"[info] Using explicit token (prefix): {token[:20]}...  len={len(token)}")
    else:
        # Show DB URL host for sanity (never print full URL)
        db_url = os.getenv("DATABASE_URL", "")
        if not db_url:
            print("[error] DATABASE_URL not set. Cannot read token from DB.", file=sys.stderr)
            print("       Set it in backend/.env or export it before running.", file=sys.stderr)
            return 2
        # Masked hint
        try:
            from urllib.parse import urlparse

            parsed = urlparse(db_url)
            print(f"[info] DATABASE_URL host: {parsed.hostname or '(unknown)'}")
        except Exception:
            pass

        token = _read_token_from_db()
        if not token:
            print("[error] No FCM device token found in system_settings (key: fcm_device_token).", file=sys.stderr)
            print("       Steps:", file=sys.stderr)
            print("         1. Build & install dev-client (see docs/wayfinder/130-fcm-verification.md)", file=sys.stderr)
            print("         2. Complete onboarding/setup (grants notification permission, POSTs token)", file=sys.stderr)
            print("         3. Verify: SELECT value FROM system_settings WHERE key='fcm_device_token';", file=sys.stderr)
            print("       Alternative: pass --token <value> to bypass DB lookup.", file=sys.stderr)
            return 1
        print(f"[info] DB token (prefix): {token[:20]}...  len={len(token)}")

    # Build data payload (all values must be strings for FCM)
    data: dict[str, str] = {}
    # send_push normalizes missing/invalid type to generic; we pass explicit type
    data["type"] = args.msg_type
    if args.conversation_id:
        data["conversation_id"] = args.conversation_id

    print(f"[info] Sending: title={args.title!r}  body={args.body!r}  data={data}  channel_id={args.channel_id!r}")

    if args.dry_run:
        print("[dry-run] Skipping actual FCM send (no credentials needed for dry-run).")
        return 0

    # Credentials check (skip for dry-run)
    raw_creds = os.getenv("FCM_SERVICE_ACCOUNT_JSON", "")
    if not raw_creds or not raw_creds.strip():
        print("[error] FCM_SERVICE_ACCOUNT_JSON not set — Firebase cannot initialize.", file=sys.stderr)
        print("       See backend/.env.example and docs/wayfinder/130-fcm-verification.md § Prerequisites.", file=sys.stderr)
        return 1
    # Quick JSON sanity (don't print content)
    try:
        import json

        cred_dict = json.loads(raw_creds)
        print(f"[info] FCM creds present: project_id={cred_dict.get('project_id', '(unknown)')}")
    except Exception as e:
        print(f"[error] FCM_SERVICE_ACCOUNT_JSON is not valid JSON: {e}", file=sys.stderr)
        return 2

    try:
        from tools.notify import send_push
    except Exception as e:
        print(f"[error] Failed to import tools.notify.send_push: {e}", file=sys.stderr)
        return 2

    ok = send_push(title=args.title, body=args.body, data=data, channel_id=args.channel_id)
    if ok:
        print("[ok] FCM push sent successfully (check device tray / logcat).")
        return 0
    else:
        print("[fail] FCM push not sent — see backend logs for reason.", file=sys.stderr)
        print("       Common causes:", file=sys.stderr)
        print("         - Token UNREGISTERED (stale uninstall) → backend auto-deletes it; re-register from device", file=sys.stderr)
        print("         - Credentials missing/malformed (see error above)", file=sys.stderr)
        print("         - Network / Firebase project mismatch (google-services.json vs service account project_id)", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
