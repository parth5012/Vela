from tools.code_exec import run_python_code
from tools.web_search import web_search
from tools.memory import save_user_memory, delete_user_memory
from tools.status_update import send_status_message
from tools.webview_browser import webview_browser
from tools.gmail import gmail_send_email, gmail_read_emails


tools_list = [
    run_python_code,
    web_search,
    save_user_memory,
    delete_user_memory,
    send_status_message,
    webview_browser,
    gmail_send_email,
    gmail_read_emails,
]

__all__ = ["tools_list"]
