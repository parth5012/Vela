# On-Device Tool-Calling Bridge & Security Consent Gates

> **Ticket**: [WF-07 (#416)](https://github.com/parth5012/Vela/issues/416)  
> **Parent Map**: [Wayfinder Map 1: On-device AI for Vela (#425)](https://github.com/parth5012/Vela/issues/425)  
> **Dependencies**: [WF-01 Product Decisions (#424)](https://github.com/parth5012/Vela/issues/424), [WF-06 Inference Service (#415)](https://github.com/parth5012/Vela/issues/415)

---

## 1. Scope & Capabilities

Per the product decisions recorded in **WF-01 (DECISIONS.md)**, on-device AI tool execution in Vela v0 is restricted to four local capability domains:

| Domain | Action | Type | Safety Tier | Parameters |
|---|---|---|---|---|
| **Alarms** | `get_alarms` | Read | Auto (OS Permission) | None |
| **Alarms** | `set_alarm` | **Mutating** | **Consent Gate (Ask)** | `hour`, `minute`, `label`, `days` |
| **Calendar** | `get_calendar_events` | Read | Auto (OS Permission) | `start_date`, `end_date` |
| **Calendar** | `create_calendar_event` | **Mutating** | **Consent Gate (Ask)** | `title`, `start_time`, `end_time`, `description` |
| **Messages** | `get_recent_messages` | Read | Auto (OS Permission) | `count`, `sender` |
| **Messages** | `send_message` | **Mutating** | **Consent Gate (Ask)** | `recipient`, `message_text` |
| **Clipboard** | `read_clipboard` | Read | Auto (OS Permission) | None |
| **Clipboard** | `write_clipboard` | **Mutating** | **Consent Gate (Ask)** | `text` |

---

## 2. Security Consent Gates & Policy

To eliminate risks of hallucinated execution, prompt injection, or unintentional device modification:

1. **Read Actions**:
   - Gated solely by Android OS runtime permissions (Calendar, SMS/Contacts, Notifications).
   - If granted, executes automatically without interrupting the conversation flow.

2. **Mutating / Write Actions**:
   - Strictly **deny-by-default**.
   - Triggers an explicit user confirmation modal presenting the action name and exact payload before dispatching.
   - If the user cancels or dismisses the modal, the tool bridge returns an error observation (`Action denied by user consent gate`). The model is informed and can explain to the user that the action was rejected.

3. **Hard Cap (Max 3 Calls per Turn)**:
   - A single user conversation turn permits at most **3** tool calls.
   - Any 4th tool invocation is immediately aborted with `limit_exceeded`, preventing infinite recursion loops.

---

## 3. Tool Execution Flow

```text
User Message: "Set an alarm for 7:30 AM named Morning Workout"
                         │
                         ▼
             [InferenceForegroundService]
                         │
                         ▼
        Model Emits: <tool_call>{"name": "set_alarm", ...}</tool_call>
                         │
                         ▼
             [OnDeviceToolBridge.parseToolCall]
                         │
        Is Mutating? ──► YES
                         │
                         ▼
             [User Confirmation Dialog]
                 │               │
            [Approved]       [Denied]
                 │               │
                 ▼               ▼
        [Native Executor]  [Return Error to Context]
                 │
                 ▼
     [Format Tool Observation: <tool_response>]
                 │
                 ▼
         [Model Continuation]
                 │
                 ▼
Final Response: "I have set your alarm for 7:30 AM named Morning Workout."
```

---

## 4. Multi-Format Tool Parser

MiniCPM5-2B supports structured output across various fine-tuning templates. The parser robustly extracts tool definitions from:

1. **XML Tags**:
   ```xml
   <tool_call>{"name": "set_alarm", "arguments": {"hour": 7, "minute": 30}}</tool_call>
   ```
2. **Markdown Code Blocks**:
   ````markdown
   ```json
   {"name": "create_calendar_event", "arguments": {"title": "Doctor"}}
   ```
   ````
3. **Raw JSON**:
   ```json
   {"name": "read_clipboard", "arguments": {}}
   ```

---

## 5. Continuation & Context Feeding

When a tool completes execution, the observation is packaged into structured XML format and appended to the model's ongoing context:

```xml
<tool_response>
{
  "tool": "set_alarm",
  "status": "success",
  "result": {
    "success": true,
    "id": "alarm_123",
    "time": "07:30",
    "label": "Morning Workout"
  },
  "error": null
}
</tool_response>
```

The model reads this observation and produces the natural-language summary for the user.

---

## 6. Implementation Reference

- Implementation: `client/utils/onDeviceToolBridge.ts`
- Test Suite: `client/__tests__/onDeviceToolBridge.test.ts` (11/11 tests passing)
- Device Action Dispatcher: `client/utils/deviceActionExecutor.ts`
- Safety Tier Classifier: `client/utils/deriveSafetyTier.ts`
