-- Owner-requested 50-minute development window, with five minutes for handoff.
-- Preserve explicitly customized policies and every monetary/token/tool cap.
ALTER TABLE repository_execution_policy ALTER COLUMN max_session_seconds SET DEFAULT 3300;
UPDATE repository_execution_policy SET max_session_seconds=3300,updated_at=now()
  WHERE max_session_seconds=1800;
