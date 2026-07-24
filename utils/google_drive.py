import os
import io
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from utils.logger import StructuredLogger

logger = StructuredLogger("GoogleDriveHelper")

def get_google_credentials(conversation_id: str, db) -> Credentials | None:
    """
    Retrieves and validates Google OAuth credentials for a given conversation.
    If global environment variables for Google Refresh Token are set, they will be used as a fallback.
    If credentials are expired, attempts to refresh them.
    """
    logger.info("Retrieving Google OAuth credentials", conversation_id=conversation_id)
    
    # 1. Check for global environment variables fallback first
    global_refresh_token = os.getenv("GOOGLE_REFRESH_TOKEN")
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    
    if global_refresh_token and client_id and client_secret:
        logger.info("Using global Google refresh token from environment variables")
        try:
            creds = Credentials(
                token=None,
                refresh_token=global_refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret,
                scopes=["https://www.googleapis.com/auth/drive.file"]
            )
            # Force refresh to populate access token
            creds.refresh(Request())
            return creds
        except Exception as e:
            logger.error("Failed to authenticate with global refresh token", error=str(e))
            # Fall back to database if global fails
            logger.info("Falling back to database-driven credentials")

    # 2. Database lookup
    token_data = db.get_oauth_tokens(conversation_id, "google")
    
    if not token_data:
        logger.warning("No Google OAuth credentials found in database", conversation_id=conversation_id)
        return None
        
    if not client_id or not client_secret:
        logger.error("Google Client ID or Client Secret not configured in environment variables")
        return None

    try:
        # Construct credentials object
        creds = Credentials(
            token=token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=["https://www.googleapis.com/auth/drive.file"]
        )
        
        # Check and refresh if token is expired
        if creds.expired and creds.refresh_token:
            logger.info("Google access token expired, refreshing...", conversation_id=conversation_id)
            creds.refresh(Request())
            
            # Save updated credentials back to database
            updated_token_data = {
                "access_token": creds.token,
                "refresh_token": creds.refresh_token,
                "expiry": creds.expiry.isoformat() if hasattr(creds.expiry, 'isoformat') else str(creds.expiry)
            }
            db.store_oauth_tokens(conversation_id, "google", updated_token_data)
            logger.info("Successfully refreshed and stored updated Google OAuth tokens", conversation_id=conversation_id)
            
        return creds
    except Exception as e:
        logger.error("Failed to load/refresh Google Credentials from database", error=str(e), conversation_id=conversation_id)
        return None

def upload_to_google_drive(credentials: Credentials, file_name: str, file_bytes: bytes, mime_type: str, folder_name: str = "Vela_CarbonVoice_Dataset") -> str | None:
    """
    Uploads a file (in-memory bytes) to Google Drive inside the specified folder.
    Uses the global GOOGLE_DRIVE_FOLDER_ID environment variable if configured.
    Otherwise, searches or creates the folder dynamically.
    """
    logger.info("Uploading file to Google Drive", file_name=file_name, mime_type=mime_type)
    try:
        service = build("drive", "v3", credentials=credentials)
        
        # 1. Resolve folder_id
        global_folder_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID")
        if global_folder_id:
            folder_id = global_folder_id
            logger.info("Using global Google Drive folder ID from environment variables", folder_id=folder_id)
        else:
            # Search for existing folder with the specified name
            query = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            results = service.files().list(q=query, fields="files(id)").execute()
            files = results.get("files", [])
            
            if files:
                folder_id = files[0]["id"]
                logger.info("Found existing Google Drive dataset folder", folder_id=folder_id)
            else:
                # Create folder
                folder_metadata = {
                    "name": folder_name,
                    "mimeType": "application/vnd.google-apps.folder"
                }
                folder = service.files().create(body=folder_metadata, fields="id").execute()
                folder_id = folder.get("id")
                logger.info("Created new Google Drive dataset folder", folder_id=folder_id)
            
        # 2. Upload file
        file_metadata = {
            "name": file_name,
            "parents": [folder_id]
        }
        media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=True)
        uploaded_file = service.files().create(body=file_metadata, media_body=media, fields="id").execute()
        file_id = uploaded_file.get("id")
        logger.info("Successfully uploaded file to Google Drive", file_id=file_id)
        return file_id
    except Exception as e:
        logger.error("Failed to upload file to Google Drive", error=str(e), file_name=file_name)
        return None
