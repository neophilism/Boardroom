-- BR-082: the server cannot authorize paid API reservations until owner
-- funding onboarding explicitly enables this flag in a future gated release.
-- DEFAULT FALSE ensures old installations, upgrades and forks spend $0.
ALTER TABLE execution_controls
  ADD COLUMN api_spending_enabled BOOLEAN NOT NULL DEFAULT FALSE;
