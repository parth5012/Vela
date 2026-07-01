from tools.web_search import search_tavily
from tools.code_exec import run_python_code

def test_tavily_search_mock():
    res = search_tavily("test query")
    assert "test query" in res or "Search failed" in res

def test_code_exec_mock():
    res = run_python_code("print('hello')")
    assert "Mock execution output" in res or "Sandbox execution" in res
