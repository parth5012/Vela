from unittest.mock import patch, MagicMock
from tools.web_search import tavily_tool
from tools.code_exec import run_python_code

@patch("langchain_tavily.TavilySearch._run")
def test_tavily_search_mock(mock_run):
    mock_run.return_value = "Mocked answer for test query"
    res = tavily_tool.invoke("test query")
    assert "Mocked answer" in res

def test_code_exec_mock():
    with patch.dict("os.environ", {"E2B_API_KEY": ""}):
        res = run_python_code.func("print('hello')")
        assert "Mock execution output" in res


def test_code_exec_api_key_set_without_e2b_installed():
    import tools.code_exec as ce
    with patch.dict("os.environ", {"E2B_API_KEY": "fake_e2b_key"}), patch.object(ce, "Sandbox", None):
        res = run_python_code.func("print('hello')")
        assert "e2b sandbox package is not installed" in res
        assert "Sandbox execution output for code run: Success." not in res


def test_code_exec_with_mocked_e2b_success():
    import tools.code_exec as ce
    mock_sandbox_instance = MagicMock()
    mock_execution = MagicMock()
    mock_execution.error = None
    mock_execution.logs.stdout = ["42\n"]
    mock_execution.logs.stderr = []
    mock_execution.results = []
    mock_sandbox_instance.run_code.return_value = mock_execution
    mock_sandbox_instance.__enter__.return_value = mock_sandbox_instance
    mock_sandbox_instance.__exit__.return_value = False

    mock_sandbox_cls = MagicMock(return_value=mock_sandbox_instance)

    with patch.dict("os.environ", {"E2B_API_KEY": "fake_e2b_key"}), patch.object(ce, "Sandbox", mock_sandbox_cls):
        res = run_python_code.func("print(42)")
        assert res == "42"
        mock_sandbox_instance.run_code.assert_called_once_with("print(42)", timeout=30)


def test_code_exec_with_mocked_e2b_error():
    import tools.code_exec as ce
    mock_sandbox_instance = MagicMock()
    mock_execution = MagicMock()
    mock_err = MagicMock()
    mock_err.name = "ZeroDivisionError"
    mock_err.value = "division by zero"
    mock_execution.error = mock_err
    mock_sandbox_instance.run_code.return_value = mock_execution
    mock_sandbox_instance.__enter__.return_value = mock_sandbox_instance
    mock_sandbox_instance.__exit__.return_value = False

    mock_sandbox_cls = MagicMock(return_value=mock_sandbox_instance)

    with patch.dict("os.environ", {"E2B_API_KEY": "fake_e2b_key"}), patch.object(ce, "Sandbox", mock_sandbox_cls):
        res = run_python_code.func("1/0")
        assert "ZeroDivisionError: division by zero" in res


def test_code_exec_with_mocked_e2b_exception():
    import tools.code_exec as ce
    mock_sandbox_cls = MagicMock(side_effect=RuntimeError("Sandbox connection timeout"))

    with patch.dict("os.environ", {"E2B_API_KEY": "fake_e2b_key"}), patch.object(ce, "Sandbox", mock_sandbox_cls):
        res = run_python_code.func("print('hi')")
        assert "Error executing code in sandbox: Sandbox connection timeout" in res


from tools.memory import save_user_memory, delete_user_memory

@patch("tools.memory.get_embeddings")
@patch("tools.memory.get_llm")
@patch("tools.memory.get_db_session")
def test_save_user_memory_tool(mock_get_db, mock_llm_func, mock_embeddings_func):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content="NONE")
    mock_llm_func.return_value = mock_llm

    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.1] * 512
    mock_embeddings_func.return_value = mock_embeddings

    mock_session = MagicMock()
    mock_session.query().filter_by().order_by().limit().first.return_value = None
    mock_get_db.return_value.__enter__.return_value = mock_session

    with patch.dict("os.environ", {"GOOGLE_API_KEY": "AIzaSyFakeKey"}):
        res = save_user_memory.func("some-conv-id", "User is a coder")
        assert "Successfully saved new memory" in res
        assert mock_session.add.called

@patch("tools.memory.get_embeddings")
@patch("tools.memory.get_llm")
@patch("tools.memory.get_db_session")
def test_save_user_memory_unrelated_threshold(mock_get_db, mock_llm_func, mock_embeddings_func):
    mock_llm = MagicMock()
    mock_llm_func.return_value = mock_llm

    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.1] + [0.0] * 511
    mock_embeddings_func.return_value = mock_embeddings

    # Mock an existing memory with an orthogonal vector to simulate distance >= 0.35 (distance = 1.0)
    from db.models import MemoryVector
    mock_vector = MemoryVector(conversation_id="some-conv-id", content="User likes cheese", vector=[0.0] * 511 + [0.9])
    
    mock_session = MagicMock()
    mock_session.query().filter_by().order_by().limit().first.return_value = mock_vector
    mock_get_db.return_value.__enter__.return_value = mock_session

    with patch.dict("os.environ", {"GOOGLE_API_KEY": "AIzaSyFakeKey"}):
        res = save_user_memory.func("some-conv-id", "User's name is Alice")
        assert "Successfully saved new memory" in res
        # LLM should NOT be called because distance is >= 0.35
        assert not mock_llm.invoke.called
        assert mock_session.add.called

@patch("tools.memory.get_embeddings")
@patch("tools.memory.get_llm")
@patch("tools.memory.get_db_session")
def test_delete_user_memory_tool(mock_get_db, mock_llm_func, mock_embeddings_func):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content="YES")
    mock_llm_func.return_value = mock_llm

    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.1] * 512
    mock_embeddings_func.return_value = mock_embeddings

    mock_session = MagicMock()
    from db.models import MemoryVector
    mock_vector = MemoryVector(conversation_id="some-conv-id", content="User is a coder", vector=[0.1] * 512)
    mock_session.query().filter_by().order_by().limit().first.return_value = mock_vector
    mock_get_db.return_value.__enter__.return_value = mock_session

    with patch.dict("os.environ", {"GOOGLE_API_KEY": "AIzaSyFakeKey"}):
        res = delete_user_memory.func("some-conv-id", "User is a coder")
        assert "Successfully deleted memory" in res
        assert mock_session.delete.called


from tools.status_update import send_status_message

@patch("tools.status_update.httpx.post")
def test_send_status_message_tool(mock_post):
    mock_res = MagicMock()
    mock_res.raise_for_status = MagicMock()
    mock_post.return_value = mock_res
    
    with patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "12345:fake_token"}):
        res = send_status_message.func(chat_id=1111, message="working on it")
        assert "Status message sent successfully" in res
        mock_post.assert_called_once()


from unittest.mock import AsyncMock
import pytest
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

@pytest.mark.asyncio
@patch("tools.device_agent.wait_for_client_event", new_callable=AsyncMock)
async def test_device_agent_tools_success(mock_wait):
    mock_wait.return_value = ("success", "Operation completed successfully")
    conv_id = "test-conv-123"
    
    res = await device_screen_read.coroutine(conv_id)
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="screen_read", target=None, value=None)
    
    res = await device_tap.coroutine(conv_id, "button1")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="tap", target="button1", value=None)
    
    res = await device_type.coroutine(conv_id, "input1", "hello")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="type", target="input1", value="hello")
    
    res = await device_scroll.coroutine(conv_id, "down")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="scroll", target="down", value=None)
    
    res = await device_swipe.coroutine(conv_id, "left")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="swipe", target="left", value=None)
    
    res = await device_press_key.coroutine(conv_id, "BACK")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="press_key", target="BACK", value=None)
    
    res = await device_open_app.coroutine(conv_id, "com.android.settings")
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="open_app", target="com.android.settings", value=None)
    
    res = await device_set_volume.coroutine(conv_id, 80)
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="set_volume", target="80", value=None)
    
    res = await device_screenshot.coroutine(conv_id)
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="screenshot", target=None, value=None)
    
    res = await device_info.coroutine(conv_id)
    assert res == "Operation completed successfully"
    mock_wait.assert_called_with(conversation_id=conv_id, action="info", target=None, value=None)

@pytest.mark.asyncio
@patch("tools.device_agent.wait_for_client_event", new_callable=AsyncMock)
async def test_device_agent_tools_failure(mock_wait):
    mock_wait.return_value = ("error", "Device not responsive")
    conv_id = "test-conv-123"
    
    res = await device_tap.coroutine(conv_id, "button1")
    assert res == "Error executing device action: Device not responsive"



