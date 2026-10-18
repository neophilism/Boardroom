# GitHub inventory and canonical plan reconciliation

Run `npm run sync:repositories` with server-only `BOARDROOM_GITHUB_APP_ID`, `BOARDROOM_GITHUB_INSTALLATION_ID`, and `BOARDROOM_GITHUB_APP_PRIVATE_KEY` provisioned as scoped secrets in the execution environment. The key must never be placed in scheduled prompts, GitHub issues, public source files, Coffee Corner, or the owner's browser.

Boardroom uses a dedicated GitHub App installation and its short-lived access tokens. The app must be installed on each repo that should participate; private repositories omitted from the installation are explicitly outside Boardroom's observed coverage. Minimal importer scopes: Metadata read, Contents read, Pull Requests read. Future fenced GitHub write gateway needs additional carefully scoped Contents/PR permissions and separate review.

On each run, the importer lists installed repos, fetches the single canonical `registry/prs.json` and actual GitHub PR state, validates approved work-unit counts, and upserts repositories, work units, lease rows, and source timestamps. Missing/malformed plans never produce fabricated tasks. Explicit PR links are used; otherwise an unambiguous exact stable-ID prefix in PR title can map to the unit. Ambiguous or unresolved PR links result in UNKNOWN, which the claim query excludes.

Owner priority is seeded to `neophilism/Boardroom` **only if no priority list exists**. The owner can later reorder it; a sync never overwrites their selected order. Other repo eligibility follows least-recently-updated GitHub activity as established by pushed_at and observed PR updated_at, not the DB's refresh clock.

This source code has no configured installation ID, token, Neon project, or scheduled reconciliation service yet. The CI tests verify normalized plan semantics; live GitHub App access and a migrated Neon branch are separate integration gates. For hundreds of repositories optimize polling through webhooks, ETags, pagination cursors and rate-limit/backoff controls (BR-057/058).


## 2026-10-18 operational correction — stale work assignments and maintenance backlog

GitHub Actions schedule entries (`*/10 * * * *`) are best effort, not guaranteed dispatches. Boardroom cannot rely on ten-minute punctuality, so the same trusted maintenance workflow runs after every `main` push and can still be manually dispatched. No new paid cron infrastructure is required.

When a new agent is admitted, the claim service checks the candidate repository's most recent successful sync. If older than 60 seconds or missing, it directly refreshes that repository from the GitHub App's authoritative pull requests and canonical registry, outside a lease transaction. The coordinator then reruns eligibility. It checks the timestamp again inside the lease transaction, so a changed candidate cannot slip through without verification. This is bounded to four candidates per claim; GitHub outages fail closed without issuing misleading stale assignments.

The internal maintenance queue coalesces legacy duplicated inventory sweeps, marks unexecuted duplicates as `SUPERSEDED` and records an audit count, while keeping a valid pending continuation. Signed GitHub webhook events coalesce queued repository-specific refreshes under a per-repository advisory lock. A new event received while a refresh is running still receives a follow-up slot. The dispatcher prefers repository-specific work while reserving periodic slots for full inventory refreshes. One inventory operation handles six repositories and carries an immutable numeric cursor.

Operational checks: inspect `operation_outbox` grouped by `state` and `operation_type`; review `maintenance.tick.completed` and `maintenance.queue.coalesced` audits; inspect `repository_sync_status.last_success_at` for Boardroom. A newly merged PR must not continue to be assigned after its targeted refresh. If a GitHub outage blocks refreshing candidates, the claim fails with an explicit retryable cause instead of allocating an unverified lease.

Do not infer actual deployment from GitHub CI or a merged PR. Render startup runs `db/migrate.ts` before serving traffic; verify the running revision and schema readiness independently.


## Partial inventory failures cannot stall healthy repositories

A live October 18 recovery pass showed two source registries failing strict verification (Superintelligence-Academy and Superintelligence-Command-Center). Previously any `report.failed>0` aborted the entire inventory cursor, so the same successful repositories were reread over and over while later repositories starved. Now a page with individually handled failures records `maintenance.inventory.partial_failure`, retains the failed repositories in ERROR/unapproved state, marks the **page operation** DONE with `PARTIAL_REPOSITORY_FAILURE`, and always schedules its verified continuation cursor. Only systemic errors (invalid API response, corrupted importer report, unavailable database or GitHub inventory) retry the page itself. This does not mark a failed repository verified or permit it to be assigned.

The owner Operations dashboard shows per-operation state and result code, and the private audit contains the bounded affected repository list for follow-up. Fix invalid source registries independently without blocking healthy repositories. A future sweep retries previously failed repositories without repeated hourly AI reasoning.
