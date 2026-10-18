# BR-039 — Continuous eligible PR chain

After the current work unit has authoritative `MERGED` or `ACCEPTED` evidence, an authenticated worker may request the next unit without releasing its repository lease. Boardroom advances the existing assignment in one database transaction and preserves the repository ID, assignment ID, lease generation and run ID.

Selection remains limited to approved units in that same repository. Local plan dependencies, source-owned cross-repository prerequisites, compatibility dependencies and unresolved Owner Actions must all be satisfied. Work already active or attached to an open PR is resumed before new pending work. A blocked unit is not selected unless it has a source-backed answered Coffee thread.

If no eligible unit remains, the endpoint returns `EXHAUSTED`; the runner checkpoints and finishes the session through the ordinary fenced release path. An unmerged current unit, stale generation, expired lease, revoked credential or owner pause fails closed. The chain endpoint cannot claim a second repository.


## Automatic reconciliation when a merged PR is missing from local state

A scheduled agent may arrive after the PR has already merged while the coordinator's local roadmap still says ACTIVE. The `boardroom_advance` implementation now reads the current immutable assignment identity, fetches the repository-owned canonical registry and actual GitHub pull requests, and derives the linked unit state from live merge timestamps. This occurs outside the database transaction. The coordinator then locks and revalidates the same run/credential/repository/lease generation/unit before writing only that unit's observed state and chaining.

An exact work-unit PR title such as `BR-004: ...` can establish the mapping if the canonical registry has no explicit PR number and only one candidate matches. Unrelated PRs, an open follow-up, ambiguous historical matches, a closed-unmerged PR, changed approved scope or a stale lease **never** count as completion. A verified ACCEPTED status is preserved only under an unchanged criteria and dependency contract. The endpoint does not assert that BR-042's full end-to-end execution gate passed.

GitHub errors return a bounded retryable evidence-unavailable error rather than falsely marking work complete. The agent can checkpoint and yield; routine repository synchronization and the next activation can retry. The audit log records successful merge reconciliation and the verified PR numbers without secret material. This path spends no model tokens and needs no owner action.

## Fifty-minute activation across projects

The activation clock starts at admission and normally permits 50 minutes of
useful work plus five minutes to checkpoint and release. A submitted PR does
not end the activation. Finish useful implementation, record exact remote
branch/head/PR/check evidence, and call `boardroom_yield_and_claim` while CI or
a unit-specific prerequisite is pending. Prefer another independent unit in the
same repository, then claim another project. The old `boardroom_advance` signature
also supports this handoff for connections with cached tool lists.

Each handoff needs a checkpoint for the current unit and returns a generation
unique in this run. It releases the old lease before claiming another. Replayed
requests reconcile the next grant without releasing it. Pending PRs retain their
source state for another activation; no dependency is satisfied by a handoff.
The same original clock, cumulative usage budgets and actual GitHub merge gates
remain in force. Stop early for a truly exhausted queue, unavailable session-wide
authority or capability, or a hard runtime/resource limit; never pad time.

Approved imported PRs resume on their actual verified branches. The server checks
head/base repository IDs, approved numeric links, source head, protected/default
branch restrictions and ambiguous multiple branches before privileged writes.
