ALTER TABLE analysis_runs
    ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_analysis_runs_user_created_at
    ON analysis_runs (user_id, created_at DESC);
