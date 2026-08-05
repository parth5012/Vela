import asyncio
import json
import os
import time
import pytest
from unittest.mock import patch, MagicMock
from httpx import AsyncClient, ASGITransport
from langchain_core.messages import AIMessageChunk

from agent.main import app, normalize_thread_id

@pytest.mark.asyncio
async def test_sse_concurrency():
    os.environ["MAX_CONCURRENT_STREAMS"] = "2"
    
    # Reset global semaphore to load env var
    import agent.main
    agent.main._concurrency_semaphore = None
    
    mock_db = MagicMock()
    mock_db_session = MagicMock()
    mock_db_session.__enter__.return_value = mock_db
    
    def mock_filter_by(id):
        conv = MagicMock()
        conv.id = id
        conv.title = "Mock Chat"
        conv.agent = "personal assistant"
        mock_result = MagicMock()
        mock_result.first.return_value = conv
        return mock_result
        
    mock_db.query.return_value.filter_by.side_effect = mock_filter_by
    
    events_log = []
    
    async def mock_astream_events(*args, **kwargs):
        initial_state = args[0]
        conv_id = initial_state.get("db_conv_id", "default")
        events_log.append(("start", conv_id, time.time()))
        
        yield {
            "event": "on_chat_model_stream",
            "name": "ChatGoogleGenerativeAI",
            "data": {
                "chunk": AIMessageChunk(content=f"Hello 1 from {conv_id}")
            }
        }
        await asyncio.sleep(0.5)
        
        yield {
            "event": "on_chat_model_stream",
            "name": "ChatGoogleGenerativeAI",
            "data": {
                "chunk": AIMessageChunk(content=f"Hello 2 from {conv_id}")
            }
        }
        await asyncio.sleep(0.5)
        
        events_log.append(("end", conv_id, time.time()))

    with patch("agent.main.get_db_session", return_value=mock_db_session),          patch("agent.main.graph.astream_events", side_effect=mock_astream_events),          patch("agent.main.get_title", return_value=MagicMock(content="Mock Chat")),          patch("agent.main.DBClient"):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = {"Authorization": "Bearer super-secret-key"}
            os.environ["VELA_API_KEY"] = "super-secret-key"
            
            payloads = [
                {"thread_id": f"thread_{i}", "message": f"msg_{i}"}
                for i in range(3)
            ]
            
            async def run_stream(idx, payload):
                async with client.stream("POST", "/chat/message", json=payload, headers=headers) as response:
                    assert response.status_code == 200
                    lines = []
                    async for line in response.aiter_lines():
                        lines.append(line)
                    return lines

            start_time = time.time()
            results = await asyncio.gather(
                run_stream(0, payloads[0]),
                run_stream(1, payloads[1]),
                run_stream(2, payloads[2])
            )
            total_duration = time.time() - start_time
            
            starts = [item for item in events_log if item[0] == "start"]
            ends = [item for item in events_log if item[0] == "end"]
            
            assert len(starts) == 3
            assert len(ends) == 3
            
            start_times = {item[1]: item[2] for item in starts}
            end_times = {item[1]: item[2] for item in ends}
            
            uuid_0 = normalize_thread_id("thread_0")
            uuid_1 = normalize_thread_id("thread_1")
            uuid_2 = normalize_thread_id("thread_2")
            
            # uuid_0 and uuid_1 should start immediately (within 0.15s)
            assert abs(start_times[uuid_0] - start_times[uuid_1]) < 0.15
            
            # uuid_2 should start only after either uuid_0 or uuid_1 ends
            min_first_end = min(end_times[uuid_0], end_times[uuid_1])
            assert start_times[uuid_2] >= min_first_end - 0.05
            
    # Total duration must be at least ~1.4s because of queuing
    assert total_duration >= 1.4
    assert total_duration < 2.5


@pytest.mark.asyncio
async def test_concurrency_semaphore_limits():
    import agent.main
    import os

    # Test default
    if "MAX_CONCURRENT_STREAMS" in os.environ:
        del os.environ["MAX_CONCURRENT_STREAMS"]
    agent.main._concurrency_semaphore = None
    sem = agent.main.get_concurrency_semaphore()
    assert sem._value == 2

    # Test ceiling 4
    os.environ["MAX_CONCURRENT_STREAMS"] = "5"
    agent.main._concurrency_semaphore = None
    sem = agent.main.get_concurrency_semaphore()
    assert sem._value == 4

    # Test normal config
    os.environ["MAX_CONCURRENT_STREAMS"] = "3"
    agent.main._concurrency_semaphore = None
    sem = agent.main.get_concurrency_semaphore()
    assert sem._value == 3

    # Test invalid string config
    os.environ["MAX_CONCURRENT_STREAMS"] = "abc"
    agent.main._concurrency_semaphore = None
    sem = agent.main.get_concurrency_semaphore()
    assert sem._value == 2

    # Test float config
    os.environ["MAX_CONCURRENT_STREAMS"] = "2.5"
    agent.main._concurrency_semaphore = None
    sem = agent.main.get_concurrency_semaphore()
    assert sem._value == 2

    # Test zero or negative config
    os.environ["MAX_CONCURRENT_STREAMS"] = "0"
    agent.main._concurrency_semaphore = None
    sem = agent.main.get_concurrency_semaphore()
    assert sem._value == 2

    os.environ["MAX_CONCURRENT_STREAMS"] = "-1"
    agent.main._concurrency_semaphore = None
    sem = agent.main.get_concurrency_semaphore()
    assert sem._value == 2
