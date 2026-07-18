import asyncio
import json
from datetime import datetime
from langchain_core.tools import tool
from langsmith import traceable
from utils.logger import StructuredLogger
from db.session import get_db_session
from db.models import WebViewAutomationSession, WebViewAutomationStep, Experience
from utils.llm import get_llm

logger = StructuredLogger("WebViewBrowserTool")

# Registry to hold event and response for active webview automation calls
# Key: conversation_id (string)
# Value: dict with "event": asyncio.Event, "response": dict
PENDING_TASKS = {}

@traceable(name="DB: Initialize Automation Step", tags=["webview", "database"])
def db_log_step_start(conversation_id: str, action: str, target: str, value: str, thoughts: str, current_url: str, minified_dom: str):
    """Checks for an active session and inserts a pending step trace into the database."""
    session_id = None
    step_number = 1
    
    with get_db_session() as db_session:
        # Check if there is an active session in the last 10 minutes
        active_session = (
            db_session.query(WebViewAutomationSession)
            .filter(
                WebViewAutomationSession.conversation_id == conversation_id,
                WebViewAutomationSession.status == "running"
            )
            .order_by(WebViewAutomationSession.created_at.desc())
            .first()
        )
        
        if active_session:
            session_id = active_session.id
            step_count = (
                db_session.query(WebViewAutomationStep)
                .filter_by(session_id=session_id)
                .count()
            )
            step_number = step_count + 1
        else:
            # Create a new session
            last_exp = (
                db_session.query(Experience)
                .filter_by(conversation_id=conversation_id)
                .order_by(Experience.created_at.desc())
                .first()
            )
            task_desc = last_exp.user_query if last_exp else f"Automate web task: {action}"
            
            new_session = WebViewAutomationSession(
                conversation_id=conversation_id,
                task_description=task_desc,
                status="running"
            )
            db_session.add(new_session)
            db_session.flush()  # populate ID
            session_id = new_session.id
            step_number = 1
            logger.info("Created new webview automation session", session_id=session_id, task=task_desc)
        
        parsed_dom = None
        if minified_dom:
            try:
                parsed_dom = json.loads(minified_dom)
            except Exception:
                parsed_dom = {"raw": minified_dom}
                
        new_step = WebViewAutomationStep(
            session_id=session_id,
            step_number=step_number,
            page_url=current_url,
            dom_snapshot=parsed_dom,
            agent_thoughts=thoughts,
            action=action,
            target=target,
            value=value,
            status="pending"
        )
        db_session.add(new_step)
        db_session.commit()
        
    return session_id, step_number

@traceable(name="Wait for Client WebView Event", tags=["webview", "network"])
async def wait_for_client_event(conversation_id: str, action: str, target: str, value: str):
    """Blocks execution and awaits the HTTP response from the mobile client WebView."""
    event = asyncio.Event()
    PENDING_TASKS[conversation_id] = {
        "event": event,
        "response": None
    }
    
    status = "error"
    result = ""
    try:
        # Wait up to 60 seconds for the mobile client to process and post the response
        await asyncio.wait_for(event.wait(), timeout=60.0)
        task_data = PENDING_TASKS.get(conversation_id)
        if task_data and task_data["response"]:
            resp = task_data["response"]
            status = resp.get("status", "error")
            result = resp.get("result", "")
        else:
            result = "No response received from the client WebView."
    except asyncio.TimeoutError:
        status = "timeout"
        result = "Timeout waiting for client WebView response. Make sure the Vela app has the browser tab open."
    finally:
        PENDING_TASKS.pop(conversation_id, None)
        
    return status, result

@traceable(name="DB: Save Step Results", tags=["webview", "database"])
def db_log_step_end(session_id: str, step_number: int, action: str, value: str, status: str, result: str):
    """Updates the database step log with execution status and returned observation."""
    with get_db_session() as db_session:
        step_record = (
            db_session.query(WebViewAutomationStep)
            .filter_by(session_id=session_id, step_number=step_number)
            .first()
        )
        if step_record:
            step_record.status = status
            step_record.observation = result
            if action == "navigate" and status == "success" and value:
                step_record.page_url = value
            db_session.commit()

@tool
@traceable(name="WebView Action: {action}", tags=["webview", "browser-automation"])
async def webview_browser(
    conversation_id: str,
    action: str,
    thoughts: str,
    target: str = None,
    value: str = None,
    current_url: str = None,
    minified_dom: str = None
) -> str:
    """Executes a browser automation command inside the client's WebView.
    
    Use this tool to navigate web pages, search Google, extract content, click buttons, or fill text inputs.
    It triggers the action locally inside the user's mobile app client and waits for the result.
    
    Args:
        conversation_id: The active conversation UUID (available in the system prompt metadata).
        action: The browser action to perform. Supported values:
            - 'navigate': Loads a URL (requires 'value' as the target URL).
            - 'click': Clicks a DOM element (requires 'target' as CSS selector or reference ID like '@e0').
            - 'fill': Clears and types text into an input field (requires 'target' as selector/ref ID and 'value' as text).
            - 'extract_dom': Scrapes the current page and returns a minified, token-optimized interactive JSON representation.
        thoughts: A detailed explanation of your reasoning: why you are performing this action and what you expect to achieve.
        target: The target CSS selector or reference element ID (e.g. '@e3') for actions like 'click' or 'fill'.
        value: The value payload (URL for 'navigate', text string for 'fill').
        current_url: The URL of the page before taking this step.
        minified_dom: The minified DOM description you currently have.
        
    Returns:
        The result of the browser action (such as minified page JSON or operation confirmation).
    """
    logger.info("WebView browser tool triggered", conversation_id=conversation_id, action=action, target=target, value=value)
    
    session_id = None
    step_number = 1
    
    # 1. Initialize step trace in DB
    try:
        session_id, step_number = db_log_step_start(
            conversation_id=conversation_id,
            action=action,
            target=target,
            value=value,
            thoughts=thoughts,
            current_url=current_url,
            minified_dom=minified_dom
        )
    except Exception as e:
        logger.error("Failed to initialize session/step log", error=str(e))

    # 2. Block and wait for client to complete execution
    status, result = await wait_for_client_event(
        conversation_id=conversation_id,
        action=action,
        target=target,
        value=value
    )

    # 3. Save step results in DB
    if session_id:
        try:
            db_log_step_end(
                session_id=session_id,
                step_number=step_number,
                action=action,
                value=value,
                status=status,
                result=result
            )
        except Exception as e:
            logger.error("Failed to save step result", error=str(e))

    if status == "success":
        return result
    else:
        return f"Error executing browser action: {result}"

@traceable(name="WebView Trajectory Evaluation", tags=["webview", "evaluation"])
async def evaluate_webview_session(session_id: str):
    """Invokes the LLM to review the step trajectory and rate success/quality."""
    logger.info("Evaluating webview automation session", session_id=session_id)
    try:
        with get_db_session() as db_session:
            session = db_session.query(WebViewAutomationSession).filter_by(id=session_id).first()
            if not session:
                logger.error("Session not found during evaluation", session_id=session_id)
                return
                
            steps = (
                db_session.query(WebViewAutomationStep)
                .filter_by(session_id=session_id)
                .order_by(WebViewAutomationStep.step_number.asc())
                .all()
            )
            
            if not steps:
                logger.warning("No steps found for session", session_id=session_id)
                session.status = "completed"
                session.is_success = True
                session.eval_score = 5.0
                session.eval_reason = "No browser actions taken."
                db_session.commit()
                return

            # Format the trajectory string
            trajectory = ""
            for s in steps:
                trajectory += (
                    f"Step {s.step_number}:\n"
                    f"- URL: {s.page_url or 'about:blank'}\n"
                    f"- Thoughts: {s.agent_thoughts or 'None'}\n"
                    f"- Action: {s.action}(target='{s.target or ''}', value='{s.value or ''}')\n"
                    f"- Observation (Status: {s.status}): {s.observation[:300] if s.observation else 'None'}\n\n"
                )

            eval_prompt = f"""You are an expert AI Agent Evaluator. Review the following trajectory of a browser automation agent and evaluate if it successfully completed the user's task.

### User Task:
"{session.task_description}"

### Trajectory of Steps:
{trajectory}

### Instructions:
Assess the run based on these criteria:
1. **Success**: Did the agent achieve the user's ultimate goal? (TRUE/FALSE)
2. **Score**: Rate the efficiency and correctness on a scale from 1.0 (failed or completely wrong) to 5.0 (perfect, fast, and correct).
3. **Rationale**: Summarize the reasoning behind your score, including issues like element selection failures, navigation loops, or timeouts.

Respond ONLY with a JSON block. No markup, conversational text, or wrapper.
Example output format:
{{"is_success": true, "eval_score": 4.5, "eval_reason": "The agent navigated successfully, clicked the correct buttons, and extracted the expected data."}}
"""
            llm = get_llm()
            response = await llm.ainvoke(eval_prompt)
            content = response.content.strip()
            
            import re
            json_match = re.search(r"\{.*?\}", content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group(0))
                session.is_success = data.get("is_success", False)
                session.eval_score = float(data.get("eval_score", 1.0))
                session.eval_reason = data.get("eval_reason", "")
                session.status = "completed" if session.is_success else "failed"
            else:
                logger.error("Failed to parse evaluation response JSON", content=content)
                session.status = "completed"
                
            session.updated_at = datetime.utcnow()
            db_session.commit()
            logger.info("WebView session evaluation stored", session_id=session_id, score=session.eval_score)
    except Exception as e:
        logger.error("Failed to evaluate webview session", error=str(e))
