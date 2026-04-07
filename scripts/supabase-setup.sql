-- Halyk AI Quiz — Supabase Schema
-- Run this in Supabase SQL Editor after creating project

-- 1. Main table
CREATE TABLE quiz_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

  -- Optional user info (nullable = anonymous)
  user_name TEXT,
  department TEXT,
  role TEXT,
  consent BOOLEAN DEFAULT false,

  -- Answers: JSONB array [{q: 0, a: 1}, {q: 1, a: 2}, ...]
  answers JSONB NOT NULL,

  -- Scores (recomputed server-side in Edge Function)
  product_scores JSONB NOT NULL,
  profile_scores JSONB NOT NULL,
  recommended_product TEXT NOT NULL CHECK (recommended_product IN ('tax_adviser', 'voice', 'chat')),
  profile TEXT NOT NULL CHECK (profile IN ('visionary', 'pragmatist', 'optimizer')),

  -- Meta
  device TEXT,
  duration_ms INTEGER,
  ip_hash TEXT
);

-- 2. RLS: NO public access. Only service_role through Edge Function
ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
-- No public policies = anon key has zero access to this table

-- 3. Dashboard view (aggregates only, no PII)
CREATE OR REPLACE VIEW quiz_stats AS
SELECT
  count(*)::int AS total,
  count(*) FILTER (WHERE profile = 'visionary')::int AS visionaries,
  count(*) FILTER (WHERE profile = 'pragmatist')::int AS pragmatists,
  count(*) FILTER (WHERE profile = 'optimizer')::int AS optimizers,
  count(*) FILTER (WHERE recommended_product = 'tax_adviser')::int AS tax_adviser_count,
  count(*) FILTER (WHERE recommended_product = 'voice')::int AS voice_count,
  count(*) FILTER (WHERE recommended_product = 'chat')::int AS chat_count,
  count(*) FILTER (WHERE user_name IS NOT NULL)::int AS identified_count
FROM quiz_sessions;

-- 4. Grant anon access to the VIEW only (no table access)
GRANT SELECT ON quiz_stats TO anon;

-- 5. Feed view for dashboard (last 10, PII-safe)
CREATE OR REPLACE VIEW quiz_feed AS
SELECT
  id,
  created_at,
  COALESCE(user_name, 'Аноним') AS display_name,
  department,
  profile,
  recommended_product
FROM quiz_sessions
ORDER BY created_at DESC
LIMIT 20;

GRANT SELECT ON quiz_feed TO anon;

-- 6. Indexes for performance
CREATE INDEX idx_quiz_sessions_created ON quiz_sessions (created_at DESC);
CREATE INDEX idx_quiz_sessions_profile ON quiz_sessions (profile);
CREATE INDEX idx_quiz_sessions_product ON quiz_sessions (recommended_product);

-- 7. Enable Realtime (run in Dashboard > Database > Replication, or:)
ALTER PUBLICATION supabase_realtime ADD TABLE quiz_sessions;
