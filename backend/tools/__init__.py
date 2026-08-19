from tools.code_exec import run_python_code
from tools.web_search import web_search
from tools.memory import save_user_memory, delete_user_memory
from tools.status_update import send_status_message
from tools.webview_browser import webview_browser
from tools.gmail import gmail_send_email, gmail_read_emails
from tools.calendar import calendar_list_events, calendar_create_event
from tools.device_agent import (
    device_screen_read,
    device_tap,
    device_type,
    device_scroll,
    device_swipe,
    device_press_key,
    device_open_app,
    device_set_volume,
    device_screenshot,
    device_info
)


tools_list = [
    run_python_code,
    web_search,
    save_user_memory,
    delete_user_memory,
    send_status_message,
    webview_browser,
    gmail_send_email,
    gmail_read_emails,
    calendar_list_events,
    calendar_create_event,
    device_screen_read,
    device_tap,
    device_type,
    device_scroll,
    device_swipe,
    device_press_key,
    device_open_app,
    device_set_volume,
    device_screenshot,
    device_info,
]

__all__ = ["tools_list"]
