# Design Spec: Telegram Gateway Dual Execution Modes (Streaming & Invoking)

**Date:** 2026-07-03  
**Status:** Approved  

## 1. Objective
Refactor the Telegram gateway to support both **Streaming** (using `astream`) and **Invoking** (using `ainvoke`) execution modes. The user should be able to toggle between these modes easily by switching the active function call in the `handle_update` method.

## 2. Approach
1. Keep common update parsing, database fetching, and input structure setup in the main `handle_update` method of `TelegramGateway`.
2. Extract the streaming-specific execution block into a private async helper method: `_run_streaming(self, chat_id: int, inputs: dict) -> list[str]`.
3. Create a new invoking-specific execution block in a private async helper method: `_run_invoking(self, chat_id: int, inputs: dict) -> list[str]`.
4. Wrap both methods under the established grace handlers for `asyncio.CancelledError` and `GeneratorExit`.
5. Call `_run_streaming` by default in `handle_update`, with `_run_invoking` commented out as a toggle option.

## 3. Detailed Implementation Plan

### `_run_streaming`
Uses `graph.astream` to iterate over events and send intermediate chatbot replies and tool executions in real-time.

### `_run_invoking`
Uses `graph.ainvoke` to execute the LangGraph workflow asynchronously to completion, then sends the resulting newly appended AI message(s).

### `handle_update`
```python
async def handle_update(self, payload: dict) -> str:
    # Setup inputs...
    try:
        # Toggle here:
        sent_replies = await self._run_streaming(chat_id, inputs)
        # sent_replies = await self._run_invoking(chat_id, inputs)
        ...
    except (asyncio.CancelledError, GeneratorExit) as cancel_err:
        ...
```
