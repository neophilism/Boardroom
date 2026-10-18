# BR-081 — Durable logical agent identities ($0 by default)

## Implemented boundaries

The owner-only `GET/POST /api/v1/owner/logical-agents` provisions **metadata records in DORMANT state**. No agent provider key, ChatGPT scheduled task, API request, worker process, new cloud service, GitHub App grant, paid inference, or tool authority is created. The endpoint uses existing owner authentication, same-origin browser mutation protections, size-limited JSON, no-store responses, and append-only owner creation audit. A credential-bound ChatGPT agent continues using its existing 601-approved display-name scheme without any migration of current sessions.

A logical agent is not a scheduled activation. Each is a server-created ULID (48-bit millisecond time plus 80 cryptographically random bits), a name, role, team and a maximum of 12 **non-authoritative capability labels**. These labels are only for catalog/search; they never authorize tools, provider spending or privileged actions. The only valid initial state is DORMANT.

GET supports keyset pagination using `cursor` (ULID) and `limit` (1–100), with a stable `nextCursor`. No O(n) fleet-wide agent count, secrets or unbounded response.

New PostgreSQL tables: `logical_agents` with indexed scope/team/state, and `logical_agent_run_links` as future provenance between a verified `agent_runs.run_id` and a logical ID. Linking and execution are intentionally not exposed: future BR-087/089 will require server-enforced budgets, capability policy and the existing lease/fencing gateway before a logical agent may become runnable.

Migration `0014_logical_agents.sql` intentionally avoids reserved in-flight 0012/0013; it does not edit existing migrations or require the competing discussion/account-email/operation-ledger work to merge first. Review final migration ordering when other PRs land. Migration is **additive**; the application deploy must apply it before any requests to the new route. If not yet applied, route fails safely rather than pretending logical registration succeeded.

## Scale constraints

Indexed keyset pages allow millions of dormant logical agents without one credential or cron job per identity. This does **not** establish million-concurrent-worker support. A million record synthetic benchmark, partitioned work queues, the non-coding tool capability gate, quota/billing ledger, and long-running provider executor are subsequent roadmap units.

## Verification

Node tests cover ULID format/time ordering/10,000 simulated ID collision check, invalid inputs including spoofed IDs, inert DORMANT creation with a fake database, and bounded/cursor queries. GitHub real PostgreSQL tests and production builds remain mandatory. No live API provider tests or billing are performed.
