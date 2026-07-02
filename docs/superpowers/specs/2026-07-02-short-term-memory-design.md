# Short-Term Conversation Memory Design

## 1. Context
The Supervisor Agent currently processes each incoming message as a single, stateless request with no awareness of previous turns in the same conversation. To enable context-aware multi-turn dialogues, we need to load the recent message history from the database at the start of graph execution and log the new interaction back to the database at the end of graph execution.

## 2. Proposed Changes

### 2.1 Entry-Point Message History Loading (`agent/graph.py`)
- In `supervisor_node`, fetch the last 5 experiences (10 messages) for the active `db_conv_id` from the `experiences` table, sorted by `created_at` ascending.
- Prepend these message pairs (HumanMessage/AIMessage) to the state's `messages` list.

### 2.2 Exit-Point Interaction Logging (`agent/graph.py`)
- In `chatbot_node`, after the LLM generates a response, save the user query and agent response as a new experience record in the database.
- Use `db_conv_id` to link the experience to the conversation.

## 3. Detailed Design

### 3.1 Fetching History
```python
with get_db_session() as session:
    # Query last 5 experiences sorted by created_at desc
    exps = (
        session.query(Experience)
        .filter_by(conversation_id=db_conv_id)
        .order_by(Experience.created_at.desc())
        .limit(5)
        .all()
    )
    # Reverse to make them chronological
    exps.reverse()
    
    # Convert to messages
    history_messages = []
    for exp in exps:
        history_messages.append(HumanMessage(content=exp.user_query))
        history_messages.append(AIMessage(content=exp.agent_response))
```

### 3.2 Saving New Experience
```python
with get_db_session() as session:
    client = DBClient(session)
    client.save_experience(
        conversation_id=db_conv_id,
        user_query=user_query,
        agent_response=agent_response
    )
```

## 4. Verification Plan
- Unit test history loading in `tests/test_graph.py` by prepopulating the database with mock experiences, running the graph, and verifying that the prompt contains the previous messages.
- Unit test history saving in `tests/test_graph.py` by running the graph and checking that a new experience record is created in the database.
