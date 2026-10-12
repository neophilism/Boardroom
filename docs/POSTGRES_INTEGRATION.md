# BR-054 — Real PostgreSQL concurrency regression tests

The public Boardroom repository now runs a PostgreSQL 17 integration job, not just TypeScript compilation or mocked database calls. GitHub Actions starts an isolated disposable PostgreSQL service named `boardroom_test`, applies the **actual production migration files** with the canonical migration runner, and executes integration tests for:

- Two simultaneous named sessions claiming distinct repo leases, with owner priority selection preserved.
- Successful heartbeat and durable checkpoint; stale lease generation rejected.
- An expired but still held repository lease remaining unavailable to another agent.
- Authorized completion/release and subsequent priority-first reclamation.
- Proper admission of a distinct named credential after previous work ends.

The test helper refuses to run unless `DATABASE_URL` points to a database containing the explicit name `boardroom_test`; it cannot accidentally seed the real Boardroom Neon production database. The GitHub Actions password is a disposable local fixture for the transient service, **not** a real user secret.

These checks establish database behavior under real PostgreSQL, but do not yet simulate malicious stale processes with independent GitHub credentials, real third-party scheduled task limits, or full production failover. Those separate gates remain open.
