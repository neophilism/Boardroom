# BR-034 — Generation-fenced GitHub write gateway

The development agent **never receives an installation access token**. Only the authenticated Boardroom server holds the scoped GitHub App private key. The public source repository never holds the private key, database URL or owner tokens.

After receiving a repository claim and using its authenticated agent credential, the agent invokes `POST /api/v1/github/write`. Every request must include `runId` and `generation` plus one explicit operation:

- `{"kind":"ensure_branch","runId":"...","generation":"..."}` creates (or reuses) `boardroom/<approved work unit ID>` from the repo's default branch. It never force-resets an existing branch.
- `{"kind":"upsert_file","runId":"...","generation":"...","path":"src/example.ts","message":"feat(BR-034): example","contentBase64":"...","expectedSha":null}` creates or optimistically updates a UTF-8 file under the work branch. Use a known existing-file blob SHA for updates. Path/content limits and protected-file restrictions apply. No direct writes to the default branch.
- `{"kind":"commit_files","runId":"...","generation":"...","expectedHeadSha":"<snapshot commit SHA>","message":"feat(BR-035): coordinated source change","files":[{"path":"src/example.ts","contentBase64":"..."},{"path":"src/obsolete.ts","contentBase64":null}]}` atomically creates, edits or deletes 1–50 ordinary source files with at most 200 KB of combined decoded text. Empty base64 creates an empty file; explicit `null` deletes an existing file. The entire batch must pass the same path, secret and content policy. Duplicate/overlapping paths, symlinks, submodules and directory replacement are rejected. Existing executable file modes are preserved; new files are ordinary nonexecutable files.
- `{"kind":"open_draft_pr","runId":"...","generation":"...","description":"..."}` opens a **draft** PR from the deterministic work branch to the actual default branch, or returns the existing open PR. It never merges or bypasses review.

Caller-supplied `repository`, `repositoryId`, `fullName`, `owner`, or `repo` fields are rejected; repository scope is always derived from the current assignment.

The authorization query checks: the credential-bound named agent, RUNNING session, approved work unit, enabled repository, current lease generation, and more than 25 seconds of remaining lease. It locks the **repository lease row through the GitHub write**. This serializes writer operations with lease release and prevents stale sessions writing after a safe takeover through this gateway. Expired/unknown sessions fail closed. An agent must heartbeat before a write when its lease is nearly expired.

**Important limitations:** This enforcement covers writes that go through Boardroom; other outside GitHub credentials may bypass it and require independent controls. Retries of GitHub content operations must reconcile source SHAs; a later outbox/idempotency PR will improve crash-exactly-once behavior. File writes intentionally exclude workflows, roadmap registries, secrets and deployment manifests pending separate owner-authorized policies. Draft PR creation is **not** a statement that CI or code-review checks passed. End-to-end execution with a configured GitHub App remains unverified.

## Atomic source batches (BR-035)

`commit_files` creates an immutable tree and commit based on the observed branch head, then performs one non-force ref update under the existing lease lock. A tree/commit staging failure leaves the branch unchanged. A ref conflict cannot publish a partial subset. If the successful response is lost, the same batch is recognized only when the observed head has the exact expected single parent, message and resulting tree; otherwise it requires a fresh source snapshot. Identical trees produce no empty commit. Rejected or abandoned staging may leave unreachable Git objects, but never a partly updated work branch.

Both the native MCP interface and trusted HTTP SDK expose this operation. The hosted model uses `commit_files` with `files: [{path, text}]` and receives the actual commit result; the broker supplies its current snapshot SHA. After a successful batch it discards cached source and rebuilds any test sandbox from the new snapshot, including deletions and changed dependency files. No broader repository authority is granted. GitHub Actions and CircleCI configuration remain owner-protected.

Git object transport follows the [GitHub tree API](https://docs.github.com/en/rest/git/trees) and its required commit/ref publication sequence. Existing repository checks and merge policy still determine acceptance.
