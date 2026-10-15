ALTER TABLE coffee_threads
  ADD COLUMN blocker_classification TEXT NOT NULL DEFAULT 'TECHNICAL'
    CHECK(blocker_classification IN ('TECHNICAL','DEPENDENCY','TEST_FAILURE','ARCHITECTURE')),
  ADD COLUMN deadline_at TIMESTAMPTZ,
  ADD CONSTRAINT coffee_threads_deadline_after_creation
    CHECK(deadline_at IS NULL OR deadline_at>created_at);
