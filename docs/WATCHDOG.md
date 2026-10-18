# BR-052 — Stale-session watchdog

A private `POST /api/v1/internal/watchdog` endpoint accepts a separate `BOARDROOM_WATCHDOG_TOKEN` (minimum 32 random characters), not the owner or agent credential. The operator or future cron job stores this token securely in its secret manager.

Each scan detects expired leases whose runs still show RUNNING. It locks the agent run, then the repository lease, and rechecks the lease after in-flight authorized writes have finished. It marks the run RECOVERING, writes an audit event, and creates or reuses an Owner Action card requesting termination and fencing verification. No expired lease is automatically released or reassigned.

**This is deliberately conservative:** an expired heartbeat is not proof of process termination. GitHub credentials outside the Boardroom write gateway can bypass its fencing. Automatic takeover remains gated on BR-053/054 and explicit runner isolation guarantees.

This PR supplies the scanner and secure endpoint, not an active cron schedule. Until a secure hourly trigger is configured and observed, do not report unattended recovery monitoring as operational.


## Native ChatGPT interruption recovery (BR-053 follow-up)

The maintenance tick first moves expired RUNNING sessions to RECOVERING. A
second pass can release an OAuth-backed ChatGPT session after an additional
60-second grace period, **only** when its registered credential is enabled,
the OAuth grant remains valid, its still-matching lease and assignment can be
locked, and no GitHub operation is INTENDED or UNCERTAIN. The transaction
marks the old run CANCELLED, increments lease generation, releases the
assignment, closes the recovery request, and writes a private audit event.
The OAuth credential is preserved, so the next scheduled run can reconnect
without a new owner consent. This is gateway fencing, not remote ChatGPT
process termination. Any old delayed Boardroom writes fail closed.

Bearer/hosted workers and cases with unresolved GitHub operations remain on
the existing manual recovery path. The Boardroom repository gateway is the
only authorized writing path for scheduled agents. Independent external
GitHub connections are outside its fencing guarantee and must not be used
for unattended repository mutations. Cancellation does not turn off the
recurring ChatGPT schedule; scheduled-task configuration remains owned by
the separate platform and is not changed by Boardroom's watchdog.

A healthy tick response reports both stale classifications and OAuth
recoveries. Verify a real maintenance tick and a genuine subsequent scheduled
arrival before declaring the production incident resolved.
