-- Signed payloads are reduced to identifiers and hashes, never retained raw.
ALTER TABLE github_events ADD COLUMN payload_sha256 TEXT
  CHECK(payload_sha256 IS NULL OR payload_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE github_events ADD COLUMN installation_id BIGINT CHECK(installation_id>0);
CREATE UNIQUE INDEX idx_github_events_payload_digest ON github_events(payload_sha256)
  WHERE payload_sha256 IS NOT NULL;
-- May reserve a generation before importing a new installed repository. No FK
-- until that repository exists; only server-verified App reads use this table.
CREATE TABLE repository_observation_fences (
  repository_id BIGINT PRIMARY KEY CHECK(repository_id>0),
  generation BIGINT NOT NULL CHECK(generation>0)
);
