import asyncio
import os
import time
import json
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, MagicMock
from contextlib import contextmanager

# Ensure MAX_CONCURRENT_STREAMS is set for tests
os.environ["MAX_CONCURRENT_STREAMS"] = "2"

# Import FastAPI app to test
from agent.main import app

class MockChunk:
    def __init__(self, content):
        self.content = content

class ConcurrencyTracker:
    def __init__(self):
        self.semaphore = asyncio.Semaphore(2)
        self.active_requests = 0
        self.max_concurrent = 0
        self.initiated_times = {}
        self.start_times = {}
        self.end_times = {}
        self.event_logs = []
        self.chunk_yield_log = []

    async def mock_astream_events(self, *args, **kwargs):
        initial_state = args[0]
        conv_id = initial_state.get("db_conv_id", "unknown-conv")
        
        # Log that the request has initiated its call (arrived at the mock generator)
        self.initiated_times[conv_id] = time.time()
        self.event_logs.append({
            "conv_id": conv_id,
            "event": "initiated",
            "time": time.time()
        })

        # Acquire semaphore to simulate the concurrency limit
        async with self.semaphore:
            self.active_requests += 1
            if self.active_requests > self.max_concurrent:
                self.max_concurrent = self.active_requests

            start_time = time.time()
            self.start_times[conv_id] = start_time
            self.event_logs.append({
                "conv_id": conv_id,
                "event": "start",
                "time": start_time
            })

            # Yield event 1
            self.chunk_yield_log.append((conv_id, "delta-1"))
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": MockChunk(f"Response from {conv_id} - Part 1")}
            }

            # Sleep to allow overlap of concurrent tasks and queueing of the 3rd task
            await asyncio.sleep(0.3)

            # Yield event 2
            self.chunk_yield_log.append((conv_id, "delta-2"))
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": MockChunk(f"Response from {conv_id} - Part 2")}
            }

            await asyncio.sleep(0.1)

            end_time = time.time()
            self.end_times[conv_id] = end_time
            self.active_requests -= 1
            self.event_logs.append({
                "conv_id": conv_id,
                "event": "end",
                "time": end_time
            })

@contextmanager
def mock_db_session():
    mock_session = MagicMock()
    
    # Dynamic query filtering logic to avoid database locks / conflicts
    def mock_query(model):
        q = MagicMock()
        
        # Setup default mock values so even if filter_by is bypassed, it doesn't fail
        mock_conv = MagicMock()
        mock_conv.id = "mock-uuid"
        mock_conv.title = "New Chat"
        mock_conv.agent = "personal assistant"
        
        mock_exp = MagicMock()
        mock_exp.id = "exp-uuid"
        mock_exp.conversation_id = "mock-uuid"
        mock_exp.user_query = "hello"
        mock_exp.agent_response = "response"
        mock_exp.created_at = time.time()
        
        q.first.return_value = mock_conv
        q.order_by.return_value.first.return_value = mock_exp
        
        def mock_filter_by(**kwargs):
            conv_id = kwargs.get("id") or kwargs.get("conversation_id") or "mock-uuid"
            mock_conv.id = conv_id
            mock_exp.conversation_id = conv_id
            return q
        
        q.filter_by.side_effect = mock_filter_by
        return q
    
    mock_session.query.side_effect = mock_query
    yield mock_session

@pytest.mark.asyncio
async def test_sse_concurrency_prototype(monkeypatch):
    # 1. Establish API authentication configuration env vars
    monkeypatch.setenv("VELA_API_KEY", "secret-test-key")
    headers = {"Authorization": "Bearer secret-test-key"}

    tracker = ConcurrencyTracker()

    # Define unique UUIDs for three concurrent threads
    thread_1 = f"thread-1-{uuid.uuid4()}"
    thread_2 = f"thread-2-{uuid.uuid4()}"
    thread_3 = f"thread-3-{uuid.uuid4()}"

    payload1 = {"thread_id": thread_1, "message": "msg 1", "agent": "personal assistant"}
    payload2 = {"thread_id": thread_2, "message": "msg 2", "agent": "personal assistant"}
    payload3 = {"thread_id": thread_3, "message": "msg 3", "agent": "personal assistant"}

    async def run_client_request(ac, payload):
        events = []
        async with ac.stream("POST", "/chat/message", json=payload, headers=headers) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"]
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    try:
                        data = json.loads(line[len("data:"):].strip())
                        events.append(data)
                    except Exception:
                        pass
        return events

    # Apply patches:
    with patch("agent.main.graph.astream_events", side_effect=tracker.mock_astream_events), \
         patch("agent.main.get_db_session", mock_db_session), \
         patch("agent.main.get_title", return_value=MockChunk("Test Title")):
         
         transport = ASGITransport(app=app)
         async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
             # Fire three requests concurrently using asyncio.gather
             results = await asyncio.gather(
                 run_client_request(ac, payload1),
                 run_client_request(ac, payload2),
                 run_client_request(ac, payload3)
             )

    # Clean UUID representations
    from agent.main import normalize_thread_id
    norm_1 = normalize_thread_id(thread_1)
    norm_2 = normalize_thread_id(thread_2)
    norm_3 = normalize_thread_id(thread_3)

    # Behavior (a) Concurrent requests overlap time
    sorted_starts = sorted(
        [(k, v) for k, v in tracker.start_times.items()], 
        key=lambda x: x[1]
    )
    assert len(sorted_starts) == 3, f"Expected 3 starts, got {sorted_starts}"
    
    first_run_thread = sorted_starts[0][0]
    second_run_thread = sorted_starts[1][0]
    third_run_thread = sorted_starts[2][0]

    assert tracker.start_times[second_run_thread] < tracker.end_times[first_run_thread], \
        "First two threads did not execute concurrently: second started after first ended."
    
    # Behavior (b) Interleaved content events across SSE connections
    first_two_events = [x for x in tracker.chunk_yield_log if x[0] in (first_run_thread, second_run_thread)]
    assert len(first_two_events) == 4, f"Expected 4 events for first two runs, got {first_two_events}"
    assert first_two_events[0][1] == "delta-1"
    assert first_two_events[1][1] == "delta-1"
    assert first_two_events[2][1] == "delta-2"
    assert first_two_events[3][1] == "delta-2"

    # Behavior (c) When requests exceed mocked constraint, queue than reject
    assert tracker.max_concurrent == 2, f"Expected max concurrent requests inside semaphore to be 2, but got {tracker.max_concurrent}"

    min_end_first_two = min(tracker.end_times[first_run_thread], tracker.end_times[second_run_thread])
    assert tracker.start_times[third_run_thread] >= min_end_first_two, \
        f"Third thread did not queue properly: started before one of the first two ended."

    # Validate that all 3 clients successfully completed and received all data
    for i, res in enumerate(results):
        content_deltas = [r["delta"] for r in res if r.get("type") == "content"]
        assert len(content_deltas) >= 2, f"Request {i+1} did not receive all content events"
        done_events = [r for r in res if r.get("type") == "done"]
        assert len(done_events) == 1, f"Request {i+1} did not receive done event"
