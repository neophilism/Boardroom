# BR-034 — Generation-fenced GitHub write gateway

The development agent **never receives an installation access token**. Only the authenticated Boardroom server holds the scoped GitHub App private key. The public source repository never holds the private key, database URL or owner tokens.

After receiving a repository claim and using its authenticated agent credential, the agent invokes `POST /api/v1/github/write`. Every request must include `runId` and `generation` plus one explicit operation:

- `{"kind":"ensure_branch","runId":"...","generation":"..."}` creates (or reuses) `boardroom/<approved work unit ID>` from the repo's default branch. It never force-resets an existing branch.
- `{"kind":"upsert_file","runId":"...","generation":"...","path":"src/example.ts","message":"feat(BR-034): example","contentBase64":"...","expectedSha":null}` creates or optimistically updates a UTF-8 file under the work branch. Use a known existing-file blob SHA for updates. Path/content limits and protected-file restrictions apply. No direct writes to the default branch.
- `{"kind":"open_draft_pr","runId":"...","generation":"...","description":"..."}` opens a **draft** PR from the deterministic work branch to the actual default branch, or returns the existing open PR. It never merges or bypasses review.

The authorization query checks: the credential-bound named agent, RUNNING session, approved work unit, enabled repository, current lease generation, and more than 25 seconds of remaining lease. It locks the **repository lease row through the GitHub write**. This serializes writer operations with lease release and prevents stale sessions writing after a safe takeover through this gateway. Expired/unknown sessions fail closed. An agent must heartbeat before a write when its lease is nearly expired.

**Important limitations:** This enforcement covers writes that go through Boardroom; other outside GitHub credentials may bypass it and require independent controls. Retries of GitHub content operations must reconcile source SHAs; a later outbox/idempotency PR will improve crash-exactly-once behavior. File writes intentionally exclude workflows, roadmap registries, secrets and deployment manifests pending separate owner-authorized policies. Draft PR creation is **not** a statement that CI or code-review checks passed. End-to-end execution with a configured GitHub App remains unverified.
