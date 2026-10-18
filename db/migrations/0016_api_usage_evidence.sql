-- BR-086: provenance-labeled model usage evidence, without authorizing charges.
-- Separate from the existing hosted-runner budget reservation and usage tables.
-- Future invoice/reconciliation must have a distinct authenticated importer.
CREATE TABLE api_usage_evidence (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(run_id) ON DELETE RESTRICT,
  logical_agent_id VARCHAR(26) COLLATE "C" REFERENCES logical_agents(agent_id) ON DELETE RESTRICT,
  operation_key TEXT NOT NULL CHECK (operation_key ~ '^model-[0-9]{1,5}$'),
  provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic','xai','google')),
  model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 120),
  model_revision TEXT NOT NULL CHECK (length(model_revision) BETWEEN 1 AND 120),
  provenance TEXT NOT NULL DEFAULT 'PROVIDER_RESPONSE' CHECK (provenance = 'PROVIDER_RESPONSE'),
  input_tokens BIGINT NOT NULL CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL CHECK (output_tokens >= 0),
  cached_input_tokens BIGINT CHECK (cached_input_tokens >= 0),
  reasoning_output_tokens BIGINT CHECK (reasoning_output_tokens >= 0),
  cache_creation_input_tokens BIGINT CHECK (cache_creation_input_tokens >= 0),
  tool_use_tokens BIGINT CHECK (tool_use_tokens >= 0),
  reported_cost_microusd BIGINT CHECK (reported_cost_microusd >= 0),
  pricing_revision TEXT,
  sanitized_evidence_sha256 CHAR(64) NOT NULL CHECK (sanitized_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT api_usage_no_invented_cost CHECK (reported_cost_microusd IS NULL AND pricing_revision IS NULL),
  UNIQUE(run_id,operation_key,provenance)
);
CREATE INDEX idx_api_usage_run_time ON api_usage_evidence(run_id,observed_at DESC);
CREATE INDEX idx_api_usage_provider_time ON api_usage_evidence(provider,model_revision,observed_at DESC);
