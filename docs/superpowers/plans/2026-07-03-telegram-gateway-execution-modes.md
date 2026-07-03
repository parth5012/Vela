# Telegram Gateway Execution Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Telegram gateway to support both streaming and invoking graph execution approaches.

**Architecture:**
- Create `_run_streaming(self, chat_id: int, inputs: dict) -> list[str]` method.
- Create `_run_invoking(self, chat_id: int, inputs: dict) -> list[str]` method.
- Update `handle_update` to call `_run_streaming` by default, with `_run_invoking` commented out as a toggle.

**Tech Stack:** Python, LangGraph, python-telegram-bot

---

### Task 1: Refactor Telegram Gateway Methods

**Files:**
- Modify: `gateway/telegram.py`

- [ ] **Step 1: Extract streaming code and add invoking code**
  Modify [gateway/telegram.py](file:///D:/work/projects/Vela/gateway/telegram.py) to define `_run_streaming` and `_run_invoking` methods, and update `handle_update` to call `_run_streaming`.

- [ ] **Step 2: Run tests to verify the refactored webhook continues to work**
  ```bash
  uv run python -m pytest tests/test_telegram.py -v
  ```
  Expected: PASS

- [ ] **Step 3: Commit changes**
  ```bash
  git add gateway/telegram.py
  git commit -m "feat: implement streaming and invoking modes in TelegramGateway"
  ```
