# Atomic repository assignment

`POST /api/v1/assignments/claim` takes JSON `{"runId":"<server-issued-uuid>"}` and a provider credential in the Authorization header. The server verifies that the credential owns this run. It returns exactly one exclusive repository assignment or IDLE.

**Ordering:** first eligible repo on the owner's ordered priority list; if none, oldest verified GitHub development timestamp among eligible nonpriority repos; ties by immutable numeric GitHub repository ID.

The Postgres transaction locks the agent run and candidate repository lease row; `FOR UPDATE OF l SKIP LOCKED` excludes candidates another transaction is claiming. Only repositories with approved eligible work units participate. Incomplete ACTIVE work precedes new PENDING work. Unresolved Owner Action dependencies block work.

The lease row retains monotonically increasing `generation` after release. An expired lease with a run ID is **not** reclaimable without separate confirmed termination/fencing (BR-053/054). Updates and merges must go through a generation-checking GitHub write gateway (BR-034); this API alone does not guarantee exclusivity against an agent with unrestricted direct GitHub write credentials.

Duplicate requests from the same running session return the same existing assignment. Runs in a terminal state cannot create new assignments. The API never chooses work based on a guessed agent memory or task number.

**Integration prerequisites:** repository onboarding must populate `repositories`, `repository_leases`, and approved `roadmap_units`; owner priorities populate `repository_priority`. Real concurrent transactions and worker cancellation must be exercised on a Neon test branch before production release. The static SQL contract tests cannot prove database-level race behavior.
