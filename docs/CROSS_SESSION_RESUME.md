# Resuming an interrupted work unit

Each hosted activation loads the durable checkpoint for its assigned stable unit. The worker keeps the checkpoint's substantive summary and next action when writing its final handoff. It restores a PR number only after the server has fetched the real PR and verified the assigned repository, deterministic branch, open/merged state and current snapshot head.

Checkpoint text cannot restore test success, merge permission, spending authority or a different repository. Closed, unmerged PRs and stale heads are not adopted. A missing PR is reconciled without inventing success; other unavailable verification fails the activation safely. Advancing to another unit discards the previous unit's cached source, sandbox and progress.

Regression coverage exercises an independent activation inspecting its existing PR and preserving a newer substantive handoff without creating duplicate source writes. This is automated regression evidence, not a claim that the production scheduled integration has run.

## Interrupted source writes

The hosted broker marks its source snapshot and passing-check state invalid before attempting a GitHub source mutation. If the reply is lost or rejected, it blocks further source edits, tests, PR opening and merge attempts until `refresh_source` observes the assigned remote branch. This refresh never repeats the mutation. It clears cached file contents and discards the old sandbox so removed files and stale installed dependencies cannot contaminate later checks.

Before yielding, the broker attempts one final read-only reconciliation. If GitHub is still unavailable, the checkpoint contains `headSha: null`, `sourceNeedsRefresh: true`, and an explicit instruction to reconcile the unknown write outcome. The next activation must inspect actual GitHub source and PR state. It must not infer failure from a missing response, reuse a previous test pass, or count the old snapshot as the latest commit.
