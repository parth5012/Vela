"""Daily morning briefing cron job execution.

Aggregates calendar events, unread inbox emails, and radar watch items,
composes a daily digest via LLM (or raw bullet fallback), sends FCM push notification,
records the briefing in the database, and sets a daily dedup marker.
"""

from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from db.session import get_db_session
from db.client import DBClient
from db.models import MemoryVector
from utils.auth_gate import get_authenticated_service
from utils.llm import get_llm, get_embeddings
from utils.logger import StructuredLogger
from tools.notify import send_push
from tools.memory import calculate_cosine_distance

logger = StructuredLogger("BriefingCron")


def run_daily_briefing(today_date: Optional[str] = None) -> Dict[str, Any]:
    """Executes the daily morning briefing cron task.

    Args:
        today_date: Optional date string in YYYY-MM-DD format. Defaults to UTC today.

    Returns:
        Dict detailing the result status, summary text, and record info.
    """
    if not today_date:
        today_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    logger.info(f"Starting run_daily_briefing for date: {today_date}")

    with get_db_session() as session:
        client = DBClient(session)

        # 1. Config Check
        config = client.get_briefing_config()
        if not config.get("enabled", True):
            logger.info("Briefing cron skipped: briefing_enabled is False")
            return {"status": "skipped", "reason": "briefing_disabled"}

        # 2. Dedup Check
        marker_key = f"briefing_sent_{today_date}"
        if client.get_system_setting(marker_key) is not None:
            logger.info(f"Briefing cron skipped: {marker_key} already set")
            return {"status": "skipped", "reason": "already_sent"}

        calendar_items: List[Dict[str, Any]] = []
        inbox_items: List[Dict[str, Any]] = []
        radar_items: List[Dict[str, Any]] = []

        # 3. Aggregation - Calendar Section
        try:
            service, err = get_authenticated_service("calendar", conversation_id="", api_version="v3")
            if err or not service:
                logger.warning("Google Calendar OAuth token missing or invalid, skipping calendar section")
            else:
                time_min = f"{today_date}T00:00:00Z"
                time_max = f"{today_date}T23:59:59Z"
                events_result = service.events().list(
                    calendarId="primary",
                    timeMin=time_min,
                    timeMax=time_max,
                    singleEvents=True,
                    orderBy="startTime",
                ).execute()
                raw_events = events_result.get("items", [])
                for ev in raw_events:
                    start_str = ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date", "")
                    end_str = ev.get("end", {}).get("dateTime") or ev.get("end", {}).get("date", "")
                    calendar_items.append({
                        "summary": ev.get("summary", "(No title)"),
                        "start": start_str,
                        "end": end_str,
                        "description": ev.get("description", ""),
                        "location": ev.get("location", ""),
                    })
                logger.info(f"Fetched {len(calendar_items)} calendar events for today")
        except Exception as e:
            logger.warning("Failed to fetch calendar events for briefing, skipping section", error=str(e))

        # 4. Aggregation - Inbox Section
        try:
            service, err = get_authenticated_service("gmail", conversation_id="")
            if err or not service:
                logger.warning("Gmail OAuth token missing or invalid, skipping inbox section")
            else:
                response = service.users().messages().list(
                    userId="me",
                    q="is:unread",
                    maxResults=5,
                ).execute()
                messages = response.get("messages", [])
                for msg in messages:
                    msg_data = service.users().messages().get(
                        userId="me",
                        id=msg["id"],
                        format="metadata",
                        metadataHeaders=["From", "Subject", "Date"],
                    ).execute()
                    headers = {h["name"]: h["value"] for h in msg_data.get("payload", {}).get("headers", [])}
                    inbox_items.append({
                        "id": msg["id"],
                        "from": headers.get("From", "(unknown)"),
                        "subject": headers.get("Subject", "(no subject)"),
                        "date": headers.get("Date", ""),
                        "snippet": msg_data.get("snippet", ""),
                    })
                logger.info(f"Fetched {len(inbox_items)} unread emails for briefing")
        except Exception as e:
            logger.warning("Failed to fetch inbox emails for briefing, skipping section", error=str(e))

        # 5. Aggregation - Radar Section
        try:
            watch_items = client.get_watch_items()
            for item in watch_items:
                item_text = item.get("text", "")
                matched_memories: List[str] = []
                if item_text:
                    try:
                        embeddings = get_embeddings()
                        item_vec = embeddings.embed_query(item_text)
                        mem_rows = session.query(MemoryVector).all()
                        scored = []
                        for m in mem_rows:
                            try:
                                dist = calculate_cosine_distance(m.vector, item_vec)
                                if dist < 0.4:
                                    scored.append((dist, m.content))
                            except Exception:
                                pass
                        scored.sort(key=lambda x: x[0])
                        matched_memories = [content for _, content in scored[:3]]
                    except Exception:
                        try:
                            mems = session.query(MemoryVector).filter(
                                MemoryVector.content.ilike(f"%{item_text}%")
                            ).limit(3).all()
                            matched_memories = [m.content for m in mems]
                        except Exception:
                            pass

                radar_items.append({
                    "id": item.get("id"),
                    "text": item_text,
                    "date_hint": item.get("date_hint"),
                    "matched_memories": matched_memories,
                })
            logger.info(f"Processed {len(radar_items)} watch items for briefing radar section")
        except Exception as e:
            logger.warning("Failed to process radar watch items for briefing", error=str(e))

        sections_data = {
            "calendar": calendar_items,
            "inbox": inbox_items,
            "radar": radar_items,
        }

        # 6. LLM Composition
        calendar_text = "\n".join([
            f"- {item['start']}: {item['summary']}" for item in calendar_items
        ]) if calendar_items else "None"

        inbox_text = "\n".join([
            f"- From: {item['from']} | Subject: {item['subject']} | Snippet: {item['snippet']}" for item in inbox_items
        ]) if inbox_items else "None"

        radar_text = "\n".join([
            f"- Watch Item: {item['text']} (Date hint: {item.get('date_hint') or 'N/A'})" +
            (f" [Related Memories: {', '.join(item['matched_memories'])}]" if item.get('matched_memories') else "")
            for item in radar_items
        ]) if radar_items else "None"

        prompt = f"""You are Vela, a personal AI assistant. Synthesize the following morning context into a concise daily briefing under 150 words.

Today's Date: {today_date}

### Calendar Events:
{calendar_text}

### Inbox (Unread Emails):
{inbox_text}

### Radar / Watch Items:
{radar_text}

Instructions:
- Keep the overall summary under 150 words.
- Be clear, direct, and actionable.
- Output ONLY the briefing text digest without markdown titles or headers.
"""

        summary_text = ""
        try:
            llm = get_llm()
            res = llm.invoke(prompt)
            if res and hasattr(res, "content") and str(res.content).strip():
                summary_text = str(res.content).strip()
            elif isinstance(res, str) and res.strip():
                summary_text = res.strip()
        except Exception as e:
            logger.warning("LLM briefing composition failed, falling back to raw digest", error=str(e))
            summary_text = ""

        if not summary_text:
            lines = [f"Daily Briefing for {today_date}:"]
            if calendar_items:
                lines.append("\nCalendar Events:")
                for item in calendar_items:
                    lines.append(f"• {item['start']}: {item['summary']}")
            if inbox_items:
                lines.append("\nUnread Emails:")
                for item in inbox_items:
                    lines.append(f"• {item['from']}: {item['subject']}")
            if radar_items:
                lines.append("\nRadar / Watch Items:")
                for item in radar_items:
                    lines.append(f"• {item['text']}")
            if len(lines) == 1:
                lines.append("No scheduled events, unread emails, or watch items for today.")
            summary_text = "\n".join(lines)

        # 7. Push Notification & Record Keeping
        push_sent = False
        try:
            push_sent = send_push(
                title="Daily Morning Briefing",
                body=summary_text,
                data={"type": "briefing"},
            )
            logger.info(f"Push notification sent status: {push_sent}")
        except Exception as e:
            logger.warning("Failed to send push notification for briefing", error=str(e))

        briefing_record = client.save_briefing(
            date=today_date,
            summary_text=summary_text,
            sections_json=sections_data,
        )

        client.set_system_setting(marker_key, datetime.now(timezone.utc).isoformat())

        logger.info(f"Daily briefing completed successfully for {today_date}", briefing_id=briefing_record.id)
        return {
            "status": "success",
            "date": today_date,
            "summary_text": summary_text,
            "briefing_id": briefing_record.id,
            "push_sent": push_sent,
        }
