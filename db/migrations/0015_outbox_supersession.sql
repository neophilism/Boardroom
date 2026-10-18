-- Retain a truthful audit trail for coalesced maintenance work: never mark
-- an unexecuted duplicate as DONE or FAILED.
ALTER TABLE operation_outbox DROP CONSTRAINT operation_outbox_state_check;
ALTER TABLE operation_outbox ADD CONSTRAINT operation_outbox_state_check
  CHECK (state IN ('PENDING','RUNNING','DONE','RETRY','FAILED','SUPERSEDED'));
CREATE INDEX idx_outbox_pending_kind ON operation_outbox(operation_type,available_at,created_at)
  WHERE state IN ('PENDING','RETRY');
CREATE INDEX idx_outbox_pending_repository ON operation_outbox((payload->>'repositoryId'))
  WHERE operation_type='sync_repository' AND state IN ('PENDING','RETRY');
