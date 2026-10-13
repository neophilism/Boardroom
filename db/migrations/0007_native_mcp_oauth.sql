-- Additive, opt-in native MCP authorization. No connection is enabled here.
CREATE TABLE oauth_grants (
  grant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES agent_credentials(credential_id),
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope='boardroom:agent'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE TABLE oauth_authorization_codes (
  code_digest TEXT PRIMARY KEY CHECK(code_digest ~ '^[a-f0-9]{64}$'),
  credential_id UUID NOT NULL REFERENCES agent_credentials(credential_id),
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope='boardroom:agent'),
  code_challenge TEXT NOT NULL CHECK(length(code_challenge)=43),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE oauth_tokens (
  token_digest TEXT PRIMARY KEY CHECK(token_digest ~ '^[a-f0-9]{64}$'),
  grant_id UUID NOT NULL REFERENCES oauth_grants(grant_id),
  token_kind TEXT NOT NULL CHECK(token_kind IN ('ACCESS','REFRESH')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_codes_expiry ON oauth_authorization_codes(expires_at);
CREATE INDEX idx_oauth_tokens_grant ON oauth_tokens(grant_id);
CREATE INDEX idx_oauth_tokens_expiry ON oauth_tokens(expires_at);
