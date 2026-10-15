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
- an exact-head approval from the repository owner before Boardroom can merge a change to its own control plane.

Missing, malformed, pending, truncated, skipped, neutral, cancelled or failed evidence blocks the operation. GitHub responses with more than the bounded first page of suites, runs, statuses or reviews are not treated as complete. The merge uses the verified expected SHA so a head change between evaluation and GitHub's merge transaction is rejected.

Only the private owner-authenticated operations endpoint can change repository merge policy. Owner changes and successful merges are audited. There is no agent-supplied bypass or exception flag.
