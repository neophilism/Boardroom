# BR-038 — Safe merge policy

Boardroom's authenticated merge endpoint is fail-closed. The owner must first enable automatic merge for the repository and name every required check in the private operations policy. A merge request is then limited to the active assignment's deterministic branch, repository ID, work unit, lease generation and caller-supplied expected head SHA.

Before a squash merge, Boardroom rechecks the exact GitHub head and requires:

- GitHub's merge state to be `CLEAN`;
- no unresolved GitHub review requirement;
- every observed check suite, check run and legacy commit status to be complete and successful;
- every owner-configured required check name to be present and successful;
- the configured number of approvals on the current head;
- no later change request;
- every local, cross-repository and owner-action prerequisite to remain satisfied; and
- an exact-head approval from the configured GitHub owner **only when the changed files include sensitive controls** (authentication, credentials, privileges, production/deployment configurations, database migrations, CI workflows, merge/write safeguards, billing or related sensitive paths). Ordinary Boardroom self-updates are not categorically blocked.

Missing, malformed, pending, truncated, skipped, neutral, cancelled or failed evidence blocks the operation. GitHub responses with more than the bounded first page of suites, runs, statuses or reviews are not treated as complete. The merge uses the verified expected SHA so a head change between evaluation and GitHub's merge transaction is rejected.

Only the private owner-authenticated operations endpoint can change repository merge policy. Owner changes, successful merges, and denied authorized preflights are audited. A denial record contains only the assigned unit, PR number, exact head SHA, and deduplicated blocker codes; if the denial cannot be persisted, Boardroom still fails closed. There is no agent-supplied bypass or exception flag.

## Approved routine merge and exception policy (October 2026)

The owner authorizes autonomous merging for routine changes when the repository has enabled automatic merging, every configured and observed CI gate passes on the exact head, the PR is clean and ready, the live assignment/lease is valid, and GitHub's own branch protection and reviewer decisions allow it. Current-head change requests always block.

Boardroom fetches the full GitHub changed-file list and verifies its count against the PR's reported total. Unknown, malformed or truncated lists block merges. Renamed files are classified using both old and new path. Changes to security controls, authentication, credentials, privileges, release or deployment configuration, database migrations, CI workflow, merge/permission gateways, and finance/billing paths require a current-head GitHub owner review. This is a conservative path-based gate, not an AI risk assertion and not a bypass of GitHub settings. New categories must be implemented and tested instead of trusting an agent's prose.

The owner does **not** need to approve each normal CI-green PR, including ordinary Boardroom changes. Human-only spending, account/credential provisioning, actual privilege changes, or legal/personal decisions continue to use Owner Actions. This policy does not grant permissions that GitHub, the owner-configured repository merge policy, or scoped agent leases withhold. No automated service claims a GitHub review it did not observe.
