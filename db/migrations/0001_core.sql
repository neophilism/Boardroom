-- Boardroom 0001: independent control-plane schema.
-- Run with db/migrate.ts against an isolated Neon branch before production rollout.
CREATE TABLE repositories (
  repository_id BIGINT PRIMARY KEY CHECK (repository_id > 0),
  full_name TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  last_development_at TIMESTAMPTZ,
  source_observed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE repository_priority (
  repository_id BIGINT PRIMARY KEY REFERENCES repositories(repository_id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  CONSTRAINT repository_priority_position_unique UNIQUE (position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE roadmap_units (
  repository_id BIGINT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL CHECK (length(unit_id) BETWEEN 2 AND 128),
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    state IN ('PENDING','ACTIVE','OPEN_PR','MERGED','ACCEPTED','BLOCKED','UNKNOWN')
  ),
  depends_on JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(depends_on) = 'array'),
  planned_prs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(planned_prs) = 'array'),
  acceptance_criteria TEXT,
  source_observed_at TIMESTAMPTZ,
  PRIMARY KEY (repository_id, unit_id)
);

CREATE TABLE agent_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'unknown',
  activation_source TEXT,
  activation_dedupe_hash TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'ADMITTED' CHECK (
    state IN ('ADMITTED','RUNNING','YIELDED','COMPLETED','BLOCKED','RECOVERING','FAILED','UNKNOWN','CANCELLED')
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CONSTRAINT ended_run_state CHECK (
    ended_at IS NULL OR state IN ('YIELDED','COMPLETED','BLOCKED','FAILED','CANCELLED')
  )
);

CREATE TABLE repository_leases (
  repository_id BIGINT PRIMARY KEY REFERENCES repositories(repository_id) ON DELETE CASCADE,
  run_id UUID UNIQUE REFERENCES agent_runs(run_id) ON DELETE RESTRICT,
  generation BIGINT NOT NULL DEFAULT 0 CHECK (generation >= 0),
  expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ,
  CHECK ((run_id IS NULL) = (expires_at IS NULL)),
  CHECK ((run_id IS NULL) = (last_heartbeat_at IS NULL)),
  CHECK ((run_id IS NULL) = (assigned_at IS NULL))
);
CREATE INDEX idx_repository_leases_running ON repository_leases (expires_at) WHERE run_id IS NOT NULL;

CREATE TABLE work_assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id BIGINT NOT NULL REFERENCES repositories(repository_id),
  run_id UUID NOT NULL REFERENCES agent_runs(run_id),
  lease_generation BIGINT NOT NULL CHECK (lease_generation > 0),
  unit_id TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  outcome TEXT,
  FOREIGN KEY (repository_id, unit_id) REFERENCES roadmap_units(repository_id, unit_id),
  CONSTRAINT released_outcome CHECK (released_at IS NULL OR outcome IS NOT NULL)
);
CREATE UNIQUE INDEX idx_one_open_repo_assignment ON work_assignments(repository_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX idx_one_open_run_assignment ON work_assignments(run_id) WHERE released_at IS NULL;

CREATE TABLE checkpoints (
  checkpoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES work_assignments(assignment_id),
  run_id UUID NOT NULL REFERENCES agent_runs(run_id),
  repository_id BIGINT NOT NULL REFERENCES repositories(repository_id),
  unit_id TEXT,
  branch TEXT,
  head_sha TEXT,
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (repository_id, unit_id) REFERENCES roadmap_units(repository_id, unit_id)
);
CREATE INDEX idx_checkpoint_latest ON checkpoints(repository_id, created_at DESC);

CREATE TABLE owner_actions (
  action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 5 AND 240),
  action_type TEXT NOT NULL CHECK (
    action_type IN ('ACCOUNT','CREDENTIAL','PURCHASE','APPROVAL','HUMAN_INPUT','OTHER')
  ),
  instructions TEXT NOT NULL,
  requested_permissions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(requested_permissions) = 'array'),
  secure_entry_location TEXT,
  price_estimate_cents BIGINT CHECK (price_estimate_cents >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION','VERIFIED','DECLINED','CANCELLED')
  ),
  source_run_id UUID REFERENCES agent_runs(run_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_unique_pending_owner_action ON owner_actions(action_key)
WHERE status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION');
CREATE INDEX idx_owner_actions_queue ON owner_actions(status, created_at);

CREATE TABLE owner_action_dependents (
  action_id UUID NOT NULL REFERENCES owner_actions(action_id) ON DELETE CASCADE,
  repository_id BIGINT NOT NULL REFERENCES repositories(repository_id),
  unit_id TEXT,
  PRIMARY KEY (action_id, repository_id),
  FOREIGN KEY (repository_id, unit_id) REFERENCES roadmap_units(repository_id, unit_id)
);

CREATE TABLE coffee_threads (
  thread_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id BIGINT REFERENCES repositories(repository_id),
  unit_id TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ANSWERED','RESOLVED','CLOSED')),
  opened_by_run_id UUID REFERENCES agent_runs(run_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (repository_id, unit_id) REFERENCES roadmap_units(repository_id, unit_id)
);
CREATE INDEX idx_coffee_threads_unanswered ON coffee_threads(status, created_at);

CREATE TABLE coffee_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES coffee_threads(thread_id) ON DELETE CASCADE,
  author_run_id UUID REFERENCES agent_runs(run_id),
  content TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coffee_messages_thread ON coffee_messages(thread_id, created_at);

CREATE TABLE github_events (
  delivery_id TEXT PRIMARY KEY,
  repository_id BIGINT REFERENCES repositories(repository_id),
  event_type TEXT NOT NULL,
  event_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  processed_at TIMESTAMPTZ
);
CREATE INDEX idx_github_events_unprocessed ON github_events(received_at) WHERE processed_at IS NULL;

CREATE TABLE operation_outbox (
  outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','RUNNING','DONE','RETRY','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_ready ON operation_outbox(available_at) WHERE state IN ('PENDING','RETRY');

CREATE TABLE audit_events (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID REFERENCES agent_runs(run_id),
  repository_id BIGINT REFERENCES repositories(repository_id),
  kind TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX idx_audit_recent ON audit_events(occurred_at DESC);
