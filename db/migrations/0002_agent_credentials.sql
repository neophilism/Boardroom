-- Boardroom 0002: provider-neutral bearer principal registry and run linkage.
-- A scheduled-task instruction never contains a task ID or an API key.
CREATE TABLE agent_credentials (
  credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 2 AND 100),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 2 AND 80),
  token_digest TEXT NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_agent_credentials_enabled ON agent_credentials(enabled);
ALTER TABLE agent_runs
  ADD COLUMN credential_id UUID REFERENCES agent_credentials(credential_id);
CREATE INDEX idx_agent_runs_source ON agent_runs(credential_id, started_at DESC);
