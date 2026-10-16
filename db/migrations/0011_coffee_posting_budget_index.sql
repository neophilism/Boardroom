-- BR-051: bound per-credential posting-budget queries across temporary runs.
CREATE INDEX idx_coffee_messages_author_created ON coffee_messages(author_run_id, created_at DESC);
