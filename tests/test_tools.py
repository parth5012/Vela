from unittest.mock import patch, MagicMock
from tools.web_search import search_tavily
from tools.code_exec import run_python_code

@patch("tools.web_search.httpx.post")
def test_tavily_search_mock(mock_post):
    mock_res = MagicMock()
    mock_res.json.return_value = {"answer": "Mocked answer for test query"}
    mock_post.return_value = mock_res
    
    with patch.dict("os.environ", {"TAVILY_API_KEY": "dummy_key"}):
        res = search_tavily.func("test query")
        assert "test query" in res

def test_code_exec_mock():
    res = run_python_code.func("print('hello')")
    assert "Mock execution output" in res or "Sandbox execution" in res

from tools.memory import save_user_memory, delete_user_memory

@patch("tools.memory.get_embeddings")
@patch("tools.memory.get_llm")
@patch("tools.memory.get_db_session")
def test_save_user_memory_tool(mock_get_db, mock_llm_func, mock_embeddings_func):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content="NONE")
    mock_llm_func.return_value = mock_llm

    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.1] * 768
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
def test_delete_user_memory_tool(mock_get_db, mock_llm_func, mock_embeddings_func):
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content="YES")
    mock_llm_func.return_value = mock_llm

    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.1] * 768
    mock_embeddings_func.return_value = mock_embeddings

    mock_session = MagicMock()
    from db.models import MemoryVector
    mock_vector = MemoryVector(conversation_id="some-conv-id", content="User is a coder", vector=[0.1] * 768)
    mock_session.query().filter_by().order_by().limit().first.return_value = mock_vector
    mock_get_db.return_value.__enter__.return_value = mock_session

    with patch.dict("os.environ", {"GOOGLE_API_KEY": "AIzaSyFakeKey"}):
        res = delete_user_memory.func("some-conv-id", "User is a coder")
        assert "Successfully deleted memory" in res
        assert mock_session.delete.called


