CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id BIGINT UNIQUE,
    discord_channel_id BIGINT UNIQUE,
    active_skill VARCHAR(50) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
    conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    token_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding VECTOR(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_conversation_id ON memory_vectors(conversation_id);

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

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT 'New Chat';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS persona VARCHAR(50) DEFAULT 'personal assistant' NOT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS active_skill VARCHAR(50) DEFAULT NULL;

