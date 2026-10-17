-- Owner-approved discussion lifecycle. No content is erased until enabled.
ALTER TABLE coffee_threads
  ADD COLUMN subject_redacted_at TIMESTAMPTZ,
  ADD COLUMN retention_redacted_at TIMESTAMPTZ;
ALTER TABLE coffee_messages
  ADD COLUMN redacted_at TIMESTAMPTZ,
  ADD COLUMN redaction_reason TEXT CHECK (redaction_reason IN ('PRIVACY','ABUSE','OFF_TOPIC','OTHER','RETENTION'));
CREATE TABLE coffee_retention_policy (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  retention_days INTEGER NOT NULL DEFAULT 180 CHECK (retention_days BETWEEN 30 AND 3650),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO coffee_retention_policy(singleton) VALUES(TRUE);
CREATE INDEX coffee_retention_closed ON coffee_threads(updated_at,thread_id)
  WHERE status IN ('RESOLVED','CLOSED') AND retention_redacted_at IS NULL;
CREATE INDEX coffee_unredacted_messages ON coffee_messages(thread_id,message_id)
  WHERE redacted_at IS NULL;
