"""Gmail tools — send and read emails through the Google Workspace auth gate."""

import os
import base64
from email.message import EmailMessage
from langchain_core.tools import tool
from googleapiclient.discovery import build
from utils.auth_gate import get_authenticated_service, AUTH_REQUIRED
from utils.logger import StructuredLogger

logger = StructuredLogger("GmailTool")


@tool
def gmail_send_email(to: str, subject: str, body: str, conversation_id: str) -> str:
    """Send an email via Gmail.

    Use this tool when the user asks to send an email, compose a message,
    or reach out to someone via email.

    Args:
        to: The recipient email address.
        subject: The email subject line.
        body: The plain-text email body content.
        conversation_id: The active conversation UUID (available in the system prompt metadata).

    Returns:
        A confirmation string, or an instruction to authenticate via the OAuth button.
    """
    service, err = get_authenticated_service("gmail", conversation_id)
    if err:
        return err

    try:
        message = EmailMessage()
        message.set_content(body)
        message["To"] = to
        message["Subject"] = subject

        encoded = base64.urlsafe_b64encode(message.as_bytes()).decode()
        body_payload = {"raw": encoded}
        service.users().messages().send(userId="me", body=body_payload).execute()
        logger.info("Email sent successfully", to=to, subject=subject)
        return f"Email sent successfully to {to} with subject '{subject}'."
    except Exception as e:
        logger.error("Failed to send email", error=str(e), to=to)
        return f"Failed to send email: {str(e)}"


@tool
def gmail_read_emails(max_results: int = 10, query: str = "", conversation_id: str = "") -> str:
    """Read recent emails from Gmail inbox.

    Use this tool when the user asks to check their inbox, read emails,
    find messages, or search their email.

    Args:
        max_results: Maximum number of emails to return (default 10, max 50).
        query: Optional Gmail search query (e.g. 'from:someone@example.com', 'subject:hello', 'is:unread').
        conversation_id: The active conversation UUID (available in the system prompt metadata).

    Returns:
        A formatted list of emails, or an auth-required instruction.
    """
    service, err = get_authenticated_service("gmail", conversation_id)
    if err:
        return err

    try:
        max_results = max(1, min(max_results, 50))
        response = (
            service.users()
            .messages()
            .list(userId="me", q=query or "", maxResults=max_results)
            .execute()
        )
        messages = response.get("messages", [])
        if not messages:
            return "No emails found matching your criteria."

        result_lines = [f"**Recent Emails ({len(messages)}):**"]
        for msg in messages:
            msg_data = (
                service.users()
                .messages()
                .get(userId="me", id=msg["id"], format="metadata", metadataHeaders=["From", "Subject", "Date"])
                .execute()
            )
            headers = {h["name"]: h["value"] for h in msg_data.get("payload", {}).get("headers", [])}
            from_ = headers.get("From", "(unknown)")
            subject = headers.get("Subject", "(no subject)")
            date = headers.get("Date", "")
            snippet = msg_data.get("snippet", "")[:80]
            result_lines.append(f"- **From:** {from_}")
            result_lines.append(f"  **Subject:** {subject}")
            result_lines.append(f"  **Date:** {date}")
            result_lines.append(f"  _{snippet}_")
            result_lines.append("")

        result = "\n".join(result_lines).strip()
        logger.info("Emails read", count=len(messages))
        return result
    except Exception as e:
        logger.error("Failed to read emails", error=str(e))
        return f"Failed to read emails: {str(e)}"
