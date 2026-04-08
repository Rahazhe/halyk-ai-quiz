-- Halyk AI Quiz — v2 Schema Migration
-- Run in Supabase SQL Editor

-- 1. Drop old CHECK constraints (product/profile values are different now)
ALTER TABLE quiz_sessions
  DROP CONSTRAINT IF EXISTS quiz_sessions_recommended_product_check,
  DROP CONSTRAINT IF EXISTS quiz_sessions_profile_check;

-- 2. Make old columns nullable (v1 data stays intact, v2 won't use them)
ALTER TABLE quiz_sessions
  ALTER COLUMN answers DROP NOT NULL,
  ALTER COLUMN product_scores DROP NOT NULL,
  ALTER COLUMN profile_scores DROP NOT NULL,
  ALTER COLUMN recommended_product DROP NOT NULL,
  ALTER COLUMN profile DROP NOT NULL;

-- 3. Add v2 columns
ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS business_type    TEXT,
  ADD COLUMN IF NOT EXISTS industry         TEXT,
  ADD COLUMN IF NOT EXISTS company_size     TEXT,
  ADD COLUMN IF NOT EXISTS priority         TEXT,
  ADD COLUMN IF NOT EXISTS digital_level    TEXT,
  ADD COLUMN IF NOT EXISTS open_q6          TEXT,
  ADD COLUMN IF NOT EXISTS open_q7          TEXT,
  ADD COLUMN IF NOT EXISTS top3_products    JSONB,
  ADD COLUMN IF NOT EXISTS ai_recommendation JSONB,
  ADD COLUMN IF NOT EXISTS used_ai          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS beta_interest    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS beta_phone       TEXT,
  ADD COLUMN IF NOT EXISTS beta_email       TEXT;

-- 4. Update quiz_stats view for new schema
CREATE OR REPLACE VIEW quiz_stats AS
SELECT
  count(*)::int AS total,
  count(*) FILTER (WHERE business_type = 'b2b')::int AS b2b_count,
  count(*) FILTER (WHERE business_type = 'b2c')::int AS b2c_count,
  count(*) FILTER (WHERE used_ai = true)::int AS ai_used_count,
  count(*) FILTER (WHERE beta_interest = true)::int AS beta_count,
  count(*) FILTER (WHERE user_name IS NOT NULL)::int AS identified_count
FROM quiz_sessions;

-- 5. Update quiz_feed view
CREATE OR REPLACE VIEW quiz_feed AS
SELECT
  id,
  created_at,
  COALESCE(user_name, 'Аноним') AS display_name,
  department,
  industry,
  business_type,
  top3_products,
  used_ai
FROM quiz_sessions
ORDER BY created_at DESC
LIMIT 20;

-- 6. Grant anon read access to views
GRANT SELECT ON quiz_stats TO anon;
GRANT SELECT ON quiz_feed TO anon;
