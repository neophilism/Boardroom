-- BR-015: prevent overlapping scheduled sessions sharing one verified principal.
-- Every scheduled task uses the same work instruction apart from its owner-assigned
-- name and one securely bound credential. Each new activation has its own run ID.
-- Existing duplicate active sessions require inspection; fail visibly rather
-- than deleting work that may still be running.
CREATE UNIQUE INDEX idx_agent_runs_one_nonterminal_per_credential
  ON agent_runs(credential_id)
  WHERE credential_id IS NOT NULL
    AND state IN ('ADMITTED','RUNNING','RECOVERING','UNKNOWN');
