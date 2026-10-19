-- BR-081: logical agents are durable records, not ChatGPT schedules or paid workers.
-- 0012 and 0013 are reserved by independent in-flight Boardroom PRs.
-- No migration row below creates an active provider instance or billable task.
CREATE TABLE logical_agents (
  agent_id VARCHAR(26) COLLATE "C" PRIMARY KEY CHECK (agent_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  scope_key TEXT NOT NULL CHECK (scope_key ~ '^[a-z][a-z0-9_-]{0,39}$'),
  team_key TEXT NOT NULL DEFAULT 'general' CHECK (team_key ~ '^[a-z][a-z0-9_-]{0,39}$'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  role TEXT NOT NULL CHECK (role IN ('development','sales','funding','research','operations','support','mission','other')),
  capability_labels JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(capability_labels) = 'array' AND jsonb_array_length(capability_labels) <= 12),
  state TEXT NOT NULL DEFAULT 'DORMANT' CHECK (state IN ('DORMANT','PAUSED','RETIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_logical_agents_scope_cursor ON logical_agents(scope_key,agent_id);
CREATE INDEX idx_logical_agents_team_state ON logical_agents(scope_key,team_key,state,agent_id);
-- Optional verified connection from a real admitted run to one logical agent.
-- This is provenance only; it never grants access or establishes executor authority.
CREATE TABLE logical_agent_run_links (
  run_id UUID PRIMARY KEY REFERENCES agent_runs(run_id) ON DELETE RESTRICT,
  agent_id VARCHAR(26) COLLATE "C" NOT NULL REFERENCES logical_agents(agent_id) ON DELETE RESTRICT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_logical_agent_run_history ON logical_agent_run_links(agent_id,observed_at DESC);
