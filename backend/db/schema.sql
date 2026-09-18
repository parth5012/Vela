CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id BIGINT UNIQUE,
    discord_channel_id BIGINT UNIQUE,
    active_skill VARCHAR(50) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    token_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (conversation_id, provider)
);
-- Migration for pre-T2 deployments whose PK was (conversation_id) only:
--   ALTER TABLE oauth_tokens DROP CONSTRAINT IF EXISTS oauth_tokens_pkey;
--   ALTER TABLE oauth_tokens ALTER COLUMN provider SET NOT NULL;
--   ALTER TABLE oauth_tokens ADD PRIMARY KEY (conversation_id, provider);
-- (Existing single-provider rows migrate cleanly: conversation_id was unique.)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    -- Width must match EMBEDDING_DIMENSIONS in db/models.py (shared with
    -- utils/llm.py:get_embeddings, where Gemini/Voyage/Jina are pinned to 512).
    embedding VECTOR(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_conversation_id ON memory_vectors(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_embedding_cosine ON memory_vectors USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_query TEXT NOT NULL,
    agent_response TEXT NOT NULL,
    eval_score FLOAT,
    eval_reason TEXT,
    consolidated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experiences_conversation_id ON experiences(conversation_id);

CREATE TABLE IF NOT EXISTS system_prompt_fragments (
    key VARCHAR(100) PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS skills_registry (
    name VARCHAR(100) PRIMARY KEY,
    description TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS webview_automation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    task_description TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'running' NOT NULL,
    is_success BOOLEAN,
    eval_score FLOAT,
    eval_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webview_automation_sessions_conversation_id ON webview_automation_sessions(conversation_id);

CREATE TABLE IF NOT EXISTS webview_automation_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES webview_automation_sessions(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    page_url TEXT,
    dom_snapshot JSONB,
    agent_thoughts TEXT,
    action VARCHAR(50) NOT NULL,
    target TEXT,
    value TEXT,
    status VARCHAR(20) NOT NULL,
    observation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webview_automation_steps_session_id ON webview_automation_steps(session_id);

CREATE TABLE IF NOT EXISTS tool_invocations (
    request_id VARCHAR(50) PRIMARY KEY,
    tool_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    result TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT 'New Chat';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent VARCHAR(50) DEFAULT 'personal assistant' NOT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS active_skill VARCHAR(50) DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'telegram' NOT NULL;

CREATE TABLE IF NOT EXISTS sync_messages (
    id VARCHAR(50) PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    provider VARCHAR(50) NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS briefings (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(255),
    date VARCHAR(10) NOT NULL,
    summary_text TEXT,
    sections_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_briefings_date ON briefings(date);

CREATE TABLE IF NOT EXISTS check_ins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    date VARCHAR(10) NOT NULL,
    mood INTEGER NOT NULL CHECK (mood >= 1 AND mood <= 5),
    energy INTEGER NOT NULL CHECK (energy >= 1 AND energy <= 5),
    win TEXT,
    carrying TEXT,
    note TEXT,
    source VARCHAR(50) DEFAULT 'android_client' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_checkins_conversation_date UNIQUE (conversation_id, date)
);

CREATE INDEX IF NOT EXISTS idx_check_ins_conversation_id ON check_ins(conversation_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_date ON check_ins(date);

