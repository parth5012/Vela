from unittest.mock import patch, MagicMock
from tools.web_search import search_tavily
from tools.code_exec import run_python_code

@patch("tools.web_search.httpx.post")
def test_tavily_search_mock(mock_post):
    mock_res = MagicMock()
    mock_res.json.return_value = {"answer": "Mocked answer for test query"}
    mock_post.return_value = mock_res
    
    with patch.dict("os.environ", {"TAVILY_API_KEY": "dummy_key"}):
        res = search_tavily("test query")
        assert "test query" in res

def test_code_exec_mock():
    res = run_python_code("print('hello')")
    assert "Mock execution output" in res or "Sandbox execution" in res

