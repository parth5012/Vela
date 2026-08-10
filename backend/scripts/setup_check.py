#!/usr/bin/env python3
"""
Vela Backend — Setup Script
Run this after `uv sync` to verify your environment is correctly configured.

Usage:
    uv run python scripts/setup_check.py
"""

import os
import sys
import io

# Fix Windows console encoding for emoji output
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Ensure we can import from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def check_env_file():
    """Check that .env exists and has required variables."""
    from dotenv import load_dotenv
    load_dotenv()

    required = {
        "GOOGLE_API_KEY": "Gemini API key (https://aistudio.google.com/apikey)",
        "VELA_API_KEY": "Client auth token (generate with: openssl rand -hex 32)",
        "DATABASE_URL": "PostgreSQL connection string",
    }

    missing = []
    warnings = []

    for var, description in required.items():
        value = os.getenv(var)
        if not value or value.startswith("your_"):
            missing.append((var, description))
        elif var == "VELA_API_KEY" and value == "vela5012":
            warnings.append(f"  ⚠ {var} is still set to the default value — change it for production!")

    return missing, warnings


def check_database_connection():
    """Verify the database is reachable and has required tables."""
    from sqlalchemy import create_engine, inspect, text
    from dotenv import load_dotenv
    load_dotenv()

    db_url = os.getenv("DATABASE_URL")
    if not db_url or db_url.startswith("your_"):
        return False, "DATABASE_URL not configured"

    try:
        engine = create_engine(db_url, pool_pre_ping=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        return False, f"Cannot connect to database: {e}"

    # Check for required tables
    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        required_tables = {
            "conversations",
            "oauth_tokens",
            "memory_vectors",
            "experiences",
            "system_prompt_fragments",
            "skills_registry",
        }
        missing_tables = required_tables - existing_tables
        if missing_tables:
            return False, f"Missing tables: {', '.join(missing_tables)}. Run schema.sql in your PostgreSQL database (e.g., Supabase SQL Editor, Neon Console, or psql)."
    except Exception as e:
        return False, f"Error inspecting tables: {e}"

    return True, "Database connected and tables exist"


def check_llm_provider():
    """Verify at least one LLM provider is configured and reachable."""
    from dotenv import load_dotenv
    load_dotenv()

    google_key = os.getenv("GOOGLE_API_KEY")
    if google_key and not google_key.startswith("your_"):
        return True, "Gemini (GOOGLE_API_KEY) configured"

    fallbacks = ["GROQ_API_KEY", "OPENROUTER_API_KEY", "COHERE_API_KEY"]
    for key in fallbacks:
        val = os.getenv(key)
        if val and not val.startswith("your_"):
            return True, f"{key} configured (no primary Gemini key)"

    return False, "No LLM provider API key configured"


def main():
    print("=" * 60)
    print("Vela Backend — Setup Check")
    print("=" * 60)
    print()

    all_ok = True

    # 1. Environment variables
    print("📋 Checking environment variables...")
    missing, warnings = check_env_file()
    if missing:
        all_ok = False
        print("  ✗ Missing required variables:")
        for var, desc in missing:
            print(f"    - {var}: {desc}")
    else:
        print("  ✓ All required variables are set")

    for w in warnings:
        print(w)

    print()

    # 2. Database
    print("🗄️  Checking database connection...")
    db_ok, db_msg = check_database_connection()
    if db_ok:
        print(f"  ✓ {db_msg}")
    else:
        all_ok = False
        print(f"  ✗ {db_msg}")

    print()

    # 3. LLM Provider
    print("🤖 Checking LLM provider...")
    llm_ok, llm_msg = check_llm_provider()
    if llm_ok:
        print(f"  ✓ {llm_msg}")
    else:
        all_ok = False
        print(f"  ✗ {llm_msg}")

    print()

    # 4. Optional features
    print("🔧 Optional features:")
    optional = {
        "TAVILY_API_KEY": "Web search",
        "E2B_API_KEY": "Sandboxed code execution",
        "TELEGRAM_BOT_TOKEN": "Telegram gateway",
        "DISCORD_BOT_TOKEN": "Discord gateway",
        "GOOGLE_CLIENT_ID": "Google OAuth (Gmail/Calendar)",
    }
    for var, feature in optional.items():
        val = os.getenv(var)
        if val and not val.startswith("your_"):
            print(f"  ✓ {feature} — enabled")
        else:
            print(f"  ○ {feature} — disabled")

    print()
    print("=" * 60)
    if all_ok:
        print("✓ Setup looks good! Start the server with:")
        print("  uv run uvicorn agent.main:app --reload")
    else:
        print("✗ Some checks failed. Fix the issues above, then re-run this script.")
        print("  See backend/CONTRIBUTING.md for detailed setup instructions.")
        sys.exit(1)


if __name__ == "__main__":
    main()