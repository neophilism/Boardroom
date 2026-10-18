-- Durable delivery receipts are notifications, never executable credentials.
ALTER TABLE operation_outbox ADD COLUMN claim_token UUID;
ALTER TABLE github_operations ADD COLUMN request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK(jsonb_typeof(request_metadata)='object');
CREATE TABLE assignment_dispatches (
  assignment_id UUID NOT NULL REFERENCES work_assignments(assignment_id),
  unit_id TEXT NOT NULL,
  outbox_id UUID NOT NULL UNIQUE REFERENCES operation_outbox(outbox_id),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ,
  PRIMARY KEY(assignment_id,unit_id)
);
CREATE INDEX idx_github_operations_unconfirmed ON github_operations(created_at)
  WHERE state IN ('INTENDED','UNCERTAIN');
