-- BR-080: one active registered credential per approved name, independent of provider.
-- The allowlist is version-controlled in registry/agent-names.json and checked
-- by the registration and arrival services. Names alone do NOT authenticate.
-- If existing active credential names collide, migration must fail visibly and
-- the owner must revoke/rotate the redundant credentials first.
CREATE UNIQUE INDEX idx_one_active_credential_per_agent_name
  ON agent_credentials(label)
  WHERE enabled = TRUE AND revoked_at IS NULL;
