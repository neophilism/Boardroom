-- Private account routing metadata; not a provider-authenticated assertion.
ALTER TABLE agent_credentials ADD COLUMN account_email TEXT;
ALTER TABLE agent_credentials ADD CONSTRAINT agent_credentials_account_email_check
  CHECK (account_email IS NULL OR (
    char_length(account_email) BETWEEN 3 AND 254
    AND account_email = lower(btrim(account_email))
    AND account_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ));
