# Resuming an interrupted work unit

Each hosted activation loads the durable checkpoint for its assigned stable unit. The worker keeps the checkpoint's substantive summary and next action when writing its final handoff. It restores a PR number only after the server has fetched the real PR and verified the assigned repository, deterministic branch, open/merged state and current snapshot head.

Checkpoint text cannot restore test success, merge permission, spending authority or a different repository. Closed, unmerged PRs and stale heads are not adopted. A missing PR is reconciled without inventing success; other unavailable verification fails the activation safely. Advancing to another unit discards the previous unit's cached source, sandbox and progress.

Regression coverage exercises an independent activation inspecting its existing PR and preserving a newer substantive handoff without creating duplicate source writes. This is automated regression evidence, not a claim that the production scheduled integration has run.
