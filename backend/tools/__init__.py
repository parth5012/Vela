from tools.code_exec import run_python_code
from tools.web_search import web_search
from tools.memory import save_user_memory, delete_user_memory
from tools.status_update import send_status_message
from tools.webview_browser import webview_browser
from tools.gmail import gmail_send_email, gmail_read_emails
from tools.calendar import calendar_list_events, calendar_create_event
from tools.notify import save_briefing_watch_item
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
    device_info,
    device_app_permission_grant,
    device_app_permission_revoke,
    device_setting_put,
    device_app_force_stop,
    device_app_set_state,
    device_app_clear_data,
    device_app_install,
    device_app_uninstall,
)

tools_list = [
    run_python_code,
    web_search,
    save_user_memory,
    delete_user_memory,
    send_status_message,
    webview_browser,
    save_briefing_watch_item,
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
    device_app_permission_grant,
    device_app_permission_revoke,
    device_setting_put,
    device_app_force_stop,
    device_app_set_state,
    device_app_clear_data,
    device_app_install,
    device_app_uninstall,
]

__all__ = ["tools_list"]
