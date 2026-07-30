"""Google Calendar tools — list and create events through the auth gate."""

from datetime import datetime, timezone, timedelta
from langchain_core.tools import tool
from googleapiclient.discovery import build
from utils.auth_gate import get_authenticated_service, AUTH_REQUIRED
from utils.logger import StructuredLogger

logger = StructuredLogger("CalendarTool")


@tool
def calendar_list_events(max_results: int = 10, conversation_id: str = "") -> str:
    """List upcoming Google Calendar events.

    Use this tool when the user asks about their schedule, upcoming meetings,
    or what's on their calendar.

    Args:
        max_results: Maximum number of events to return (default 10).
        conversation_id: The active conversation UUID (available in the system prompt metadata).

    Returns:
        A formatted list of upcoming events, or an auth-required instruction.
    """
    service, err = get_authenticated_service("calendar", conversation_id, api_version="v3")
    if err:
        return err

    try:
        now = datetime.now(timezone.utc).isoformat()
        week_later = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()

        events_result = (
            service.events()
            .list(
                calendarId="primary",
                timeMin=now,
                timeMax=week_later,
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        events = events_result.get("items", [])

        if not events:
            return "No upcoming events found in the next 7 days."

        lines = [f"**Upcoming Events (next {len(events)}):**"]
        for event in events:
            start = event["start"].get("dateTime", event["start"].get("date"))
            summary = event.get("summary", "(No title)")
            lines.append(f"- {start}: {summary}")

        result = "\n".join(lines)
        logger.info("Calendar events listed", count=len(events))
        return result
    except Exception as e:
        logger.error("Failed to list calendar events", error=str(e))
        return f"Failed to list calendar events: {str(e)}"


@tool
def calendar_create_event(
    summary: str,
    start_time: str,
    end_time: str,
    description: str = "",
    location: str = "",
    conversation_id: str = "",
) -> str:
    """Create a new event on Google Calendar.

    Use this tool when the user asks to schedule a meeting, appointment,
    or add an event to their calendar.

    Args:
        summary: The event title.
        start_time: Start time in ISO 8601 format (e.g. '2026-08-01T14:00:00').
        end_time: End time in ISO 8601 format (e.g. '2026-08-01T15:00:00').
        description: Optional event description or notes.
        location: Optional physical location or video call link.
        conversation_id: The active conversation UUID (available in the system prompt metadata).

    Returns:
        A confirmation with the event link, or an auth-required instruction.
    """
    service, err = get_authenticated_service("calendar", conversation_id, api_version="v3")
    if err:
        return err

    try:
        event_body = {
            "summary": summary,
            "description": description or "",
            "location": location or "",
            "start": {
                "dateTime": start_time,
                "timeZone": "UTC",
            },
            "end": {
                "dateTime": end_time,
                "timeZone": "UTC",
            },
        }

        created = service.events().insert(calendarId="primary", body=event_body).execute()
        event_link = created.get("htmlLink", "")
        logger.info("Calendar event created", summary=summary, event_id=created.get("id"))
        return f"Event '{summary}' created successfully. {event_link}"
    except Exception as e:
        logger.error("Failed to create calendar event", error=str(e), summary=summary)
        return f"Failed to create calendar event: {str(e)}"
