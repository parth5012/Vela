"""
Parameterized mock backend for Vela E2E verification.

Reads fixture JSON files and serves deterministic responses for each feature.
Usage:
    python mock_server.py --fixture chat
    python mock_server.py --fixture all  # serves all fixtures merged
"""
import json
import time
import sys
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import uvicorn

app = FastAPI()

# Global fixture store
FIXTURES = {}
CURRENT_FIXTURE = None


def load_fixture(name: str) -> dict:
    """Load a fixture JSON file from the fixtures/ directory."""
    fixture_path = Path(__file__).parent / "fixtures" / f"{name}.json"
    if not fixture_path.exists():
        raise FileNotFoundError(f"Fixture not found: {fixture_path}")
    with open(fixture_path) as f:
        return json.load(f)


def load_all_fixtures() -> dict:
    """Load all fixture files and merge endpoints."""
    fixtures_dir = Path(__file__).parent / "fixtures"
    merged = {"endpoints": {}}
    for fixture_file in sorted(fixtures_dir.glob("*.json")):
        with open(fixture_file) as f:
            data = json.load(f)
            merged["endpoints"].update(data.get("endpoints", {}))
    return merged


@app.get("/health")
def health():
    if CURRENT_FIXTURE and "/health" in CURRENT_FIXTURE.get("endpoints", {}):
        return CURRENT_FIXTURE["endpoints"]["/health"]
    return {"status": "ok", "version": 1.0}


@app.get("/chat/threads")
def get_threads():
    if CURRENT_FIXTURE and "/chat/threads" in CURRENT_FIXTURE.get("endpoints", {}):
        return CURRENT_FIXTURE["endpoints"]["/chat/threads"]
    return []


@app.post("/chat/message")
async def chat_message(req: Request):
    data = await req.json()
    agent = data.get("agent", "personal assistant")
    message = data.get("message", "")

    # Check for fixture-defined response
    if CURRENT_FIXTURE and "/chat/message" in CURRENT_FIXTURE.get("endpoints", {}):
        endpoint = CURRENT_FIXTURE["endpoints"]["/chat/message"]
        delay_ms = endpoint.get("delay_ms", 50)
        events = endpoint.get("events", [])

        def sse_from_fixture():
            for event in events:
                time.sleep(delay_ms / 1000.0)
                yield f"data: {json.dumps(event)}\n\n"
            # If no done event, add one
            if not any(e.get("type") == "done" for e in events):
                done = {"type": "done", "thread_title": f"Chat: {message}"[:60]}
                yield f"data: {json.dumps(done)}\n\n"

        return StreamingResponse(sse_from_fixture(), media_type="text/event-stream")

    # Default response
    def default_stream():
        response_text = f"[{agent.upper()}] Response to: {message}"
        for chunk in response_text.split(" "):
            if not chunk:
                continue
            payload = {"type": "content", "delta": chunk + " "}
            yield f"data: {json.dumps(payload)}\n\n"
            time.sleep(0.05)
        done = {"type": "done", "thread_title": f"Chat: {message}"[:60]}
        yield f"data: {json.dumps(done)}\n\n"

    return StreamingResponse(default_stream(), media_type="text/event-stream")


@app.get("/tasks")
def get_tasks():
    if CURRENT_FIXTURE and "/tasks" in CURRENT_FIXTURE.get("endpoints", {}):
        return CURRENT_FIXTURE["endpoints"]["/tasks"]
    return []


@app.post("/tasks")
async def create_task(req: Request):
    data = await req.json()
    return {**data, "id": "mock-task-001", "status": "active"}


@app.get("/settings")
def get_settings():
    if CURRENT_FIXTURE and "/settings" in CURRENT_FIXTURE.get("endpoints", {}):
        return CURRENT_FIXTURE["endpoints"]["/settings"]
    return {}


@app.get("/local-ai/models")
def get_local_models():
    if CURRENT_FIXTURE and "/local-ai/models" in CURRENT_FIXTURE.get("endpoints", {}):
        return CURRENT_FIXTURE["endpoints"]["/local-ai/models"]
    return []


@app.post("/local-ai/download")
async def download_model(req: Request):
    return {"status": "started", "model_id": "mock-model"}


@app.get("/device-agent/status")
def device_agent_status():
    if CURRENT_FIXTURE and "/device-agent/status" in CURRENT_FIXTURE.get("endpoints", {}):
        return CURRENT_FIXTURE["endpoints"]["/device-agent/status"]
    return {"status": "idle"}


@app.post("/device-agent/execute")
async def execute_device_action(req: Request):
    return {"status": "completed", "result": "mock-result"}


@app.post("/fcm/register")
async def register_fcm(req: Request):
    return {"status": "registered", "token": "mock-fcm-token"}


@app.get("/fcm/status")
def fcm_status():
    if CURRENT_FIXTURE and "/fcm/status" in CURRENT_FIXTURE.get("endpoints", {}):
        return CURRENT_FIXTURE["endpoints"]["/fcm/status"]
    return {"registered": True}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Vela E2E Mock Server")
    parser.add_argument("--fixture", default="chat", help="Fixture name or 'all'")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    args = parser.parse_args()

    if args.fixture == "all":
        CURRENT_FIXTURE = load_all_fixtures()
        print(f"Loaded all fixtures merged")
    else:
        CURRENT_FIXTURE = load_fixture(args.fixture)
        print(f"Loaded fixture: {args.fixture}")

    print(f"Starting mock server on {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)
