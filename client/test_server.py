import json
import time
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
import uvicorn

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok", "version": 1.0}

@app.get("/chat/threads")
def get_threads():
    return []

@app.post("/chat/message")
async def chat_message(req: Request):
    data = await req.json()
    agent = data.get("agent", "personal assistant")
    message = data.get("message", "")

    def event_stream():
        response_text = (
            f"<thought>User asked: {message}. Planning a thorough answer with "
            f"multiple considerations and edge cases.</thought>"
            f"[{agent.upper()}] Response to: {message} "
            + ("This is a long streaming response with many tokens to test long chat rendering. " * 5)
        )
        for chunk in response_text.split(" "):
            if not chunk:
                continue
            payload = {"type": "content", "delta": chunk + " "}
            yield f"data: {json.dumps(payload)}\n\n"
            time.sleep(0.05)
        done = {"type": "done", "thread_title": f"Chat: {message}"[:60]}
        yield "data: " + json.dumps(done) + "\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
