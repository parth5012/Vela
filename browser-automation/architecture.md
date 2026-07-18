# System Architecture & Communication Flow

The Vela browser automation architecture uses a **Client-in-the-Loop Async Tool Execution** model. This design addresses several constraints imposed by deploying the backend to serverless cloud providers (like Render's free tier) and interacting with mobile clients.

## Architecture Constraints & Solutions

1. **Resource Constraints**: Render's free tier has a 512MB RAM limit, which is too small to launch a headless Chrome/Chromium instance (which typically requires 1GB+).
   * *Solution*: Offload browser rendering to the physical Android device. The client app runs the actual browser inside a standard mobile WebView.
2. **NAT / Firewall Traversal**: Physical phones are behind residential Wi-Fi NATs or cellular firewalls, making it impossible for a cloud backend to call a local browser API server directly.
   * *Solution*: Use a persistent Server-Sent Events (SSE) connection initiated by the mobile client to stream commands down, and standard HTTP POST requests to return results.

---

## Detailed Execution Loop

```
[Vela Backend (FastAPI)]              [SSE Stream Connection]              [Vela Client (Expo App)]
           |                                     |                                     |
    (Graph execution)                            |                                     |
           |                                     |                                     |
   Tool: webview_browser                         |                                     |
  - creates DB Session                           |                                     |
  - creates DB Step                              |                                     |
  - blocks on asyncio.Event                      |                                     |
  - yields tool_start event -------------------->|                                     |
           |                                     |                              (Intercepts event)
           |                                     |                              - displays WebView panel
           |                                     |                              - runs navigation or script
           |                                     |                                     |
           |                                     |                              (Executes script)
           |                                     |                              - extracts minified JSON
           |                                     |                                     |
           |                                     |<-- POST /chat/webview/response -----+
           |                                     |   (body: {status, result})          |
           |                                     |                                     |
   (Endpoint receives POST)                      |                                     |
   - updates Step in DB                          |                                     |
   - resolves PENDING_TASK event                 |                                     |
           |                                     |                                     |
   (Tool execution resumes)                      |                                     |
   - returns output to Agent                     |                                     |
           |                                     |                                     |
    (Next Graph step)                            |                                     |
```

### 1. Step Initiation
When the LangGraph supervisor decides to execute a browser action, it invokes the `webview_browser` tool. 
The tool logic:
* Checks if a session is currently running for the conversation; if not, it opens a session.
* Inserts a record into the `webview_automation_steps` database with `status="pending"`.
* Registers an `asyncio.Event` in a global dict mapped to the `conversation_id`.
* Blocks, waiting for the event to trigger.

### 2. SSE Signal Traversal
The FastAPI streaming generator yields an `on_tool_start` chunk formatted as:
```xml
<call:webview_browser input="{\\"conversation_id\\": \\\"...\\\", \\\"action\\\": \\\"navigate\\\", \\\"value\\\": \\\"https://google.com\\\"}">
```
This is delivered immediately to the client over the HTTP Event Stream.

### 3. Client Interception & Action
The Expo client intercepts this chunk during stream decoding:
* Parses the arguments.
* Toggles the split-screen WebView container.
* Triggers the action inside the WebView (either loading a URL or injecting an action script).

### 4. Handoff Response
Once the WebView finishes loading or executes the script, it posts the output back to the client application, which issues a REST POST callback to `/chat/webview/response` on the FastAPI server containing the execution payload.

### 5. Loop Continuation
The API endpoint parses the payload, updates the database step, maps the response back to the `PENDING_TASKS` block, and calls `event.set()`. The blocked `webview_browser` tool function awakens, reads the result, and returns it to the agent, which continues generating the answer or proceeds to the next browser step.
