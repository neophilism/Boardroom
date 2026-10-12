-- Additive execution contracts. Existing deployments remain paused for auto-merge
-- until an owner explicitly sets a repository policy with required check names.
CREATE TABLE execution_controls (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO execution_controls(singleton) VALUES(TRUE);
CREATE TABLE repository_execution_policy (
  repository_id BIGINT PRIMARY KEY REFERENCES repositories(repository_id),
  auto_merge BOOLEAN NOT NULL DEFAULT FALSE,
  required_checks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(required_checks)='array'),
  minimum_reviews INTEGER NOT NULL DEFAULT 0 CHECK(minimum_reviews BETWEEN 0 AND 10),
  max_session_seconds INTEGER NOT NULL DEFAULT 1800 CHECK(max_session_seconds BETWEEN 60 AND 14400),
  max_tool_calls INTEGER NOT NULL DEFAULT 100 CHECK(max_tool_calls BETWEEN 1 AND 1000),
  max_tokens INTEGER NOT NULL DEFAULT 100000 CHECK(max_tokens BETWEEN 1 AND 10000000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE github_operations (
  operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id BIGINT NOT NULL REFERENCES repositories(repository_id),
  unit_id TEXT NOT NULL,
  run_id UUID NOT NULL REFERENCES agent_runs(run_id),
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
  state TEXT NOT NULL DEFAULT 'INTENDED' CHECK(state IN ('INTENDED','CONFIRMED','UNCERTAIN')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  UNIQUE(repository_id,idempotency_key)
);
CREATE TABLE usage_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(run_id),
  operation_key TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK(input_tokens>=0),
  output_tokens INTEGER NOT NULL CHECK(output_tokens>=0),
  cost_microusd BIGINT CHECK(cost_microusd>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id,operation_key)
);
CREATE TABLE compatibility_dependencies (
  repository_id BIGINT NOT NULL REFERENCES repositories(repository_id),
  unit_id TEXT NOT NULL,
  prerequisite_repository_id BIGINT NOT NULL REFERENCES repositories(repository_id),
  prerequisite_unit_id TEXT NOT NULL,
  PRIMARY KEY(repository_id,unit_id,prerequisite_repository_id,prerequisite_unit_id),
  FOREIGN KEY(repository_id,unit_id) REFERENCES roadmap_units(repository_id,unit_id),
  FOREIGN KEY(prerequisite_repository_id,prerequisite_unit_id) REFERENCES roadmap_units(repository_id,unit_id)
);
CREATE TABLE integration_evidence (
  gate TEXT PRIMARY KEY CHECK(gate IN ('scheduled_arrival','live_code_pr','recovery','unattended_acceptance')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_id UUID REFERENCES agent_runs(run_id),
  evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='object')
);
ALTER TABLE operation_outbox ADD COLUMN claimed_at TIMESTAMPTZ;
ALTER TABLE operation_outbox ADD COLUMN last_error_code TEXT;
CREATE INDEX idx_usage_run ON usage_events(run_id,created_at);
CREATE TABLE runner_budget_reservations (
  reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(run_id),
  operation_key TEXT NOT NULL,
  reserved_microusd BIGINT NOT NULL CHECK(reserved_microusd>0),
  charged_microusd BIGINT CHECK(charged_microusd>=0 AND charged_microusd<=reserved_microusd),
  state TEXT NOT NULL DEFAULT 'RESERVED' CHECK(state IN ('RESERVED','COMMITTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id,operation_key)
);
