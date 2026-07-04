import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Query, responses, Request, BackgroundTasks
from google_auth_oauthlib.flow import Flow
from db.supabase import SupabaseDB
from gateway.telegram import TelegramGateway
from gateway.discord import DiscordGateway
from cron.consolidate import run_self_improvement
from utils.logger import StructuredLogger

logger = StructuredLogger("VelaServer")
db = SupabaseDB()
telegram_gateway = TelegramGateway(db=db)
discord_gateway = DiscordGateway(db=db)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # logger.info("Initializing background services...")
    # discord_task = asyncio.create_task(discord_gateway.start())
    yield
    # logger.info("Shutting down background services...")
    # await discord_gateway.close()
    # discord_task.cancel()
    # try:
    #     await discord_task
    # except asyncio.CancelledError:
    #     pass

app = FastAPI(title="Vela Server", lifespan=lifespan)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events"
]

@app.get("/")
def health():
    logger.info("Health check pinged")
    return {"status": "ok"}

    
@app.get("/health")
def health_check():
    logger.info("Health check pinged")
    return {"status": "ok"}

@app.get("/oauth/login")
def oauth_login(chat_id: int):
    logger.info("Generating Google OAuth login URL", chat_id=chat_id)
    client_config = {
        "web": {
            "client_id": os.getenv("GOOGLE_CLIENT_ID", "mock_id"),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", "mock_secret"),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token"
        }
    }
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/oauth/callback")
    )
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=str(chat_id)
    )
    return responses.RedirectResponse(authorization_url)

@app.get("/oauth/callback")
def oauth_callback(code: str, state: str):
    telegram_chat_id = int(state)
    logger.info("Received Google OAuth redirect callback", state_chat_id=telegram_chat_id)
    conv_id = db.get_or_create_conversation(telegram_chat_id)
    
    # Exchanging mock code (would exchange real credentials with code in production)
    token_data = {
        "access_token": "mock_access_token",
        "refresh_token": "mock_refresh_token",
        "expiry": "2026-07-01T12:00:00Z"
    }
    db.store_oauth_tokens(conv_id, "google", token_data)
    
    html_content = """
    <html>
        <head>
            <style>
                body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #1e1e2e; color: #cdd6f4; }
                .card { background: #313244; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
                h1 { color: #a6e3a1; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Authorization Successful!</h1>
                <p>Gmail and Google Calendar have been successfully linked to Vela.</p>
                <p>You can close this tab now and return to Telegram.</p>
            </div>
        </body>
    </html>
    """
    return responses.HTMLResponse(content=html_content)

@app.post("/webhooks/telegram")
async def telegram_webhook(request: Request, background_tasks: BackgroundTasks):
    logger.info("Telegram webhook endpoint triggered")
    payload = await request.json()
    background_tasks.add_task(telegram_gateway.handle_update, payload)
    return {"status": "processed", "result": "Task scheduled in background"}

@app.post("/consolidate")
def trigger_consolidation():
    logger.info("Triggering nightly self-improvement consolidation loop")
    msg = run_self_improvement()
    logger.info("Consolidation loop completed", result=msg)
    return {"status": "success"}
