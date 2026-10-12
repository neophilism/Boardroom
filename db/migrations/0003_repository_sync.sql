-- Boardroom 0003: source reconciliation provenance without fabricated freshness.
CREATE TABLE repository_sync_status (
  repository_id BIGINT PRIMARY KEY REFERENCES repositories(repository_id) ON DELETE CASCADE,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ,
  plan_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (plan_status IN ('VERIFIED','MISSING','UNVERIFIED','ERROR')),
  last_error TEXT,
  last_plan_version INTEGER
);
