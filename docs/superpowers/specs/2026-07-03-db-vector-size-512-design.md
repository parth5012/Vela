# Design Spec: Migrate DB Vector Size to 512

**Date:** 2026-07-03  
**Status:** Approved  

## 1. Objective
Update the vector embedding size across the application and Supabase database from `768` to `512` to align with the primary Gemini embedding models (`models/gemini-embedding-2`), which output 512-dimensional vectors.

## 2. Approach
We are using **Approach 1**, which involves:
1. Recreating the `memory_vectors` table in the Supabase database.
2. Updating `db/schema.sql` to specify `VECTOR(512)`.
3. Updating SQLAlchemy ORM models in `db/models.py`.
4. Updating unit tests to mock and assert 512-dimensional vectors instead of 768-dimensional vectors.

## 3. Detailed Changes

### 3.1. Database Migration (Supabase SQL)
Run the following script in the Supabase SQL editor to drop the old table and recreate it with the correct vector size:

```sql
DROP TABLE IF EXISTS memory_vectors;
CREATE TABLE memory_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding VECTOR(512) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

### 3.2. Codebase Updates

#### Schema Definition
In [db/schema.sql](file:///D:/work/projects/Vela/db/schema.sql):
- Change `embedding VECTOR(768) NOT NULL` to `embedding VECTOR(512) NOT NULL`.

#### SQLAlchemy Model
In [db/models.py](file:///D:/work/projects/Vela/db/models.py):
- Update `MemoryVector` `vector` column to `Vector(512)`.

#### Unit Tests
Update vector mocks and assertions from length `768` to `512` in:
- [tests/test_graph.py](file:///D:/work/projects/Vela/tests/test_graph.py)
- [tests/test_llm_fallback.py](file:///D:/work/projects/Vela/tests/test_llm_fallback.py)
- [tests/test_tools.py](file:///D:/work/projects/Vela/tests/test_tools.py)
