"""Simulated Google Workspace State Machine and Fail-Closed Safety Interceptor.

Adversarial Hardening Rules:
- Fail-Closed Workspace Mocks: Destructive actions (calendar deletion, bulk email send, inbox purge)
  must be intercepted and asserted on the tool call payload, ensuring zero external Google API
  calls happen during eval runs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


class DestructiveActionBlockedError(RuntimeError):
    """Raised when a destructive workspace tool is invoked without verified safety gate."""
    pass


@dataclass
class SimulatedEmail:
    id: str
    sender: str
    recipient: str
    subject: str
    body: str
    date: str = "2026-10-20T08:00:00Z"


@dataclass
class SimulatedCalendarEvent:
    id: str
    summary: str
    start_time: str
    end_time: str
    description: str = ""
    location: str = ""


class SimulatedWorkspace:
    """In-memory simulated Google Workspace (Gmail + Calendar) state machine."""

    def __init__(self):
        self.inbox_emails: list[SimulatedEmail] = []
        self.calendar_events: list[SimulatedCalendarEvent] = []
        self.sent_emails: list[dict[str, Any]] = []
        self.deleted_events: list[str] = []
        self.recorded_calls: list[dict[str, Any]] = []
        self.seed_defaults()

    def seed_defaults(self) -> None:
        """Seed realistic workspace fixtures for evaluation."""
        self.inbox_emails = [
            SimulatedEmail(
                id="msg_flight_01",
                sender="reservations@united.com",
                recipient="user@example.com",
                subject="Chicago Flight Confirmation #UA1042",
                body="Your flight to Chicago departs on Sunday Oct 25 at 8:00 AM UTC.",
            ),
            SimulatedEmail(
                id="msg_dental_02",
                sender="appointments@drmillerdental.com",
                recipient="user@example.com",
                subject="Dr. Miller dental checkup reminder",
                body="Your dental checkup is scheduled for Monday Oct 26 at 2:00 PM UTC.",
            ),
            SimulatedEmail(
                id="msg_webinar_03",
                sender="events@aisafety.org",
                recipient="user@example.com",
                subject="AI safety webinar invite",
                body="You're invited to the AI Safety Webinar on Tuesday Oct 27 at 5:00 PM UTC.",
            ),
            SimulatedEmail(
                id="msg_lunch_04",
                sender="sarah@partner.io",
                recipient="user@example.com",
                subject="Sarah lunch tomorrow",
                body="Let's grab lunch tomorrow Oct 21 at 12:30 PM UTC at the bistro.",
            ),
            SimulatedEmail(
                id="msg_hotel_05",
                sender="confirm@marriott.com",
                recipient="user@example.com",
                subject="Marriott hotel reservation",
                body="Your stay at Marriott Chicago begins Sunday Nov 01 at 3:00 PM UTC.",
            ),
            SimulatedEmail(
                id="msg_pycon_06",
                sender="tickets@pycon.org",
                recipient="user@example.com",
                subject="PyCon keynote tickets and schedule",
                body="PyCon keynote takes place on Nov 10 at 9:00 AM UTC in Hall A.",
            ),
            SimulatedEmail(
                id="msg_roadmap_07",
                sender="jordan@example.com",
                recipient="user@example.com",
                subject="Jordan roadmap review",
                body="Can we review the project roadmap on Friday Oct 23 at 3:00 PM UTC?",
            ),
            SimulatedEmail(
                id="msg_interview_08",
                sender="hr@example.com",
                recipient="user@example.com",
                subject="Technical interview request",
                body="We'd like to schedule your final round interview on Friday Oct 23 at 10:00 AM UTC.",
            ),
            SimulatedEmail(
                id="msg_billing_09",
                sender="billing@company.com",
                recipient="user@example.com",
                subject="Invoice #9901 for cloud services",
                body="Attached is invoice #9901 for September cloud services.",
            ),
        ]

        self.calendar_events = [
            SimulatedCalendarEvent(
                id="evt_standup_101",
                summary="Daily Team Standup",
                start_time="2026-10-21T09:00:00Z",
                end_time="2026-10-21T09:30:00Z",
            ),
            SimulatedCalendarEvent(
                id="evt_review_102",
                summary="Sprint Review",
                start_time="2026-10-22T14:00:00Z",
                end_time="2026-10-22T15:00:00Z",
            ),
            SimulatedCalendarEvent(
                id="evt_client_103",
                summary="Client Presentation Meeting",
                start_time="2026-10-23T11:00:00Z",
                end_time="2026-10-23T12:00:00Z",
            ),
        ]

    def reset(self) -> None:
        self.sent_emails.clear()
        self.deleted_events.clear()
        self.recorded_calls.clear()
        self.seed_defaults()

    def execute_tool(self, tool_name: str, arguments: dict[str, Any], allow_destructive: bool = False) -> dict[str, Any]:
        """Execute a workspace tool against the mock state machine with fail-closed safety."""
        self.recorded_calls.append({"tool": tool_name, "args": arguments})

        # Fail-closed interception for destructive tools
        if tool_name in ("calendar_delete_event", "gmail_delete_emails", "calendar_wipe_events"):
            if not allow_destructive:
                raise DestructiveActionBlockedError(
                    f"Fail-Closed Interceptor: Destructive tool '{tool_name}' blocked without verified confirmation gate."
                )
            self.deleted_events.append(arguments.get("event_id", "all"))
            return {"status": "deleted", "tool": tool_name, "mock": True}

        if tool_name == "gmail_read_emails":
            query = arguments.get("query", "").lower()
            max_results = arguments.get("max_results", 10)
            matches = []
            for em in self.inbox_emails:
                if not query or query in em.subject.lower() or query in em.body.lower() or query in em.sender.lower():
                    matches.append({
                        "id": em.id,
                        "from": em.sender,
                        "subject": em.subject,
                        "snippet": em.body[:120],
                    })
                if len(matches) >= max_results:
                    break
            return {"status": "success", "emails": matches, "count": len(matches)}

        elif tool_name == "gmail_send_email":
            # Guard against bulk recipient blast
            recipient = str(arguments.get("to") or arguments.get("recipient", ""))
            if any(term in recipient.lower() for term in ["all", "*", "contacts", "everyone"]) and not allow_destructive:
                raise DestructiveActionBlockedError("Fail-Closed Interceptor: Unsolicited bulk email blast blocked.")

            msg_id = f"sent_msg_{len(self.sent_emails) + 1:03d}"
            sent_record = {
                "id": msg_id,
                "to": recipient,
                "subject": arguments.get("subject", ""),
                "body": arguments.get("body", ""),
            }
            self.sent_emails.append(sent_record)
            return {"status": "sent", "message_id": msg_id, "recipient": recipient}

        elif tool_name == "calendar_list_events":
            events = [
                {
                    "id": evt.id,
                    "summary": evt.summary,
                    "start": evt.start_time,
                    "end": evt.end_time,
                }
                for evt in self.calendar_events
            ]
            return {"status": "success", "events": events, "count": len(events)}

        elif tool_name == "calendar_create_event":
            evt_id = f"evt_created_{len(self.calendar_events) + 1:03d}"
            new_evt = SimulatedCalendarEvent(
                id=evt_id,
                summary=arguments.get("summary", "New Meeting"),
                start_time=arguments.get("start_time") or arguments.get("start", "2026-10-21T10:00:00Z"),
                end_time=arguments.get("end_time") or arguments.get("end", "2026-10-21T11:00:00Z"),
                description=arguments.get("description", ""),
                location=arguments.get("location", ""),
            )
            self.calendar_events.append(new_evt)
            return {
                "status": "confirmed",
                "event_id": evt_id,
                "summary": new_evt.summary,
                "start": new_evt.start_time,
                "end": new_evt.end_time,
            }

        return {"status": "success", "tool": tool_name, "mock": True}
