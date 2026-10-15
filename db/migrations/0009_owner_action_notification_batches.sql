-- BR-030: durable, deduplicated private owner-action notification batches.
CREATE TABLE owner_action_notification_batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 16 AND 120),
  reminder_date DATE NOT NULL,
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 5 AND 160),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 20 AND 20000),
  action_count INTEGER NOT NULL CHECK (action_count > 0 AND action_count <= 250),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','SENT','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX idx_owner_action_notification_pending
  ON owner_action_notification_batches(created_at)
  WHERE state='PENDING';
