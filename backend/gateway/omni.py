import asyncio
import os
import secrets
import uuid

from fastapi import WebSocket, WebSocketDisconnect, status
from langchain_core.messages import HumanMessage, SystemMessage

from utils.llm import get_llm
from utils.logger import StructuredLogger

logger = StructuredLogger("OmniGateway")


async def handle_omni_session(websocket: WebSocket, token: str | None = None):
    expected_key = os.getenv("VELA_API_KEY", "vela5012")
    if (
        not expected_key
        or expected_key.startswith("your_")
        or not token
        or not secrets.compare_digest(token.encode("utf-8"), expected_key.encode("utf-8"))
    ):
        logger.warning("Omni websocket connection rejected: invalid or missing token")
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    session_id = str(uuid.uuid4())
    logger.info("Omni websocket session established", session_id=session_id)

    # Initial handshake
    await websocket.send_json({
        "type": "session_ready",
        "session_id": session_id,
        "model": "liquid-lfm-omni",
        "supported_inputs": ["text", "audio_frame", "image_frame"],
        "supported_outputs": ["transcript_token"],
    })

    current_image_keyframe: str | None = None
    active_turn_task: asyncio.Task | None = None

    async def run_text_turn(prompt_text: str, keyframe_b64: str | None):
        try:
            llm = get_llm()
            system_prompt = (
                "You are Vela Omni, a real-time conversational personal assistant with eyes and ears. "
                "Respond concisely and naturally in spoken conversation style."
            )
            if keyframe_b64:
                human_content = [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{keyframe_b64}"}},
                ]
            else:
                human_content = prompt_text

            messages = [SystemMessage(content=system_prompt), HumanMessage(content=human_content)]
            full_transcript = []

            # Try streaming tokens from the LLM
            if hasattr(llm, "astream"):
                async for chunk in llm.astream(messages):
                    token_str = chunk.content if hasattr(chunk, "content") else str(chunk)
                    if token_str:
                        full_transcript.append(token_str)
                        await websocket.send_json({
                            "type": "transcript_token",
                            "text": token_str,
                            "session_id": session_id,
                        })
            else:
                resp = await llm.ainvoke(messages)
                content = resp.content if hasattr(resp, "content") else str(resp)
                full_transcript.append(content)
                await websocket.send_json({
                    "type": "transcript_token",
                    "text": content,
                    "session_id": session_id,
                })

            await websocket.send_json({
                "type": "turn_complete",
                "session_id": session_id,
                "full_transcript": "".join(full_transcript),
            })
        except asyncio.CancelledError:
            logger.info("Omni turn cancelled by interrupt/barge-in", session_id=session_id)
            raise
        except Exception as e:  # noqa: BLE001
            logger.error("Omni generation error", session_id=session_id, error=str(e))
            await websocket.send_json({
                "type": "turn_complete",
                "session_id": session_id,
                "full_transcript": "I encountered an error processing that turn.",
                "error": str(e),
            })

    try:
        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue
            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "image_frame":
                current_image_keyframe = data.get("data")
                logger.info("Omni keyframe updated", session_id=session_id)

            elif msg_type == "text_prompt":
                text = data.get("text")
                if not isinstance(text, str) or not text.strip():
                    continue
                logger.info("Omni text prompt received", session_id=session_id, length=len(text))

                if active_turn_task and not active_turn_task.done():
                    active_turn_task.cancel()

                active_turn_task = asyncio.create_task(run_text_turn(text.strip(), current_image_keyframe))

            elif msg_type == "audio_frame":
                audio_b64 = data.get("data", "")
                is_end_of_speech = data.get("end_of_speech", False)
                if is_end_of_speech and audio_b64:
                    # Full neural audio output synthesis pipeline will link to Liquid Voice;
                    # currently acknowledges audio frame ingestion and marks turn complete
                    await websocket.send_json({
                        "type": "turn_complete",
                        "session_id": session_id,
                        "full_transcript": "Audio stream received.",
                    })

            elif msg_type == "interrupt":
                logger.info("Omni user barge-in / interrupt", session_id=session_id)
                if active_turn_task and not active_turn_task.done():
                    active_turn_task.cancel()
                    active_turn_task = None

                await websocket.send_json({
                    "type": "interrupted",
                    "session_id": session_id,
                })

    except WebSocketDisconnect:
        logger.info("Omni websocket session disconnected", session_id=session_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("Omni session uncaught exception", session_id=session_id, error=str(exc))
    finally:
        if active_turn_task and not active_turn_task.done():
            active_turn_task.cancel()
