# BR-052 — Stale-session watchdog

A private `POST /api/v1/internal/watchdog` endpoint accepts a separate `BOARDROOM_WATCHDOG_TOKEN` (minimum 32 random characters), not the owner or agent credential. The operator or future cron job stores this token securely in its secret manager.

Each scan detects expired leases whose runs still show RUNNING. It locks the agent run, then the repository lease, and rechecks the lease after in-flight authorized writes have finished. It marks the run RECOVERING, writes an audit event, and creates or reuses an Owner Action card requesting termination and fencing verification. No expired lease is automatically released or reassigned.

**This is deliberately conservative:** an expired heartbeat is not proof of process termination. GitHub credentials outside the Boardroom write gateway can bypass its fencing. Automatic takeover remains gated on BR-053/054 and explicit runner isolation guarantees.

This PR supplies the scanner and secure endpoint, not an active cron schedule. Until a secure hourly trigger is configured and observed, do not report unattended recovery monitoring as operational.
