-- Private owner-planned names. Reservations do not issue credentials or connect accounts.
CREATE TABLE agent_name_reservations (
  name TEXT PRIMARY KEY CHECK(length(name) BETWEEN 1 AND 100),
  account_slot SMALLINT NOT NULL CHECK(account_slot BETWEEN 2 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_name_reservations_slot ON agent_name_reservations(account_slot,name);
