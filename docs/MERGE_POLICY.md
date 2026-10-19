# BR-038 — GitHub-enforced autonomous merge policy

## Standing owner authorization (October 18, 2026)

The owner authorizes Boardroom to merge dependency-ready, assigned pull requests
**without additional independent human review** when:

1. The repository is enabled for automatic merging and every owner-configured
   required CI check is present and successful on the exact current PR head.
   Every observed check run, check suite and commit status must also have passed.
2. GitHub reports the PR as mergeable with a clean merge state.
3. All **actual GitHub branch-protection, ruleset and reviewer requirements** are
   satisfied. GitHub enforces them again in its merge transaction.
4. The PR is open and not a draft, its head has not changed, its branch/repository
   match the current authorized work assignment, the lease is valid, and
   approved work prerequisites remain satisfied.

No extra GitHub owner review, independent-human audit, reviewer count, security
certification, or path-based human sign-off is imposed by Boardroom, including
for authentication, CI, migration, security, deployment and merge-policy files.
These sensitive changes still warrant substantive AI-assisted source/security
review and automated tests. The voluntary `change-review.ts` filename classifier
is advisory only and does not block otherwise-eligible merges.

**If GitHub itself requires a review**, its blocked merge state prevents merging
until that review is satisfied. Boardroom does not modify, waive or bypass
GitHub branch protection. A requested or missing review is not independently
enforced when GitHub does not require it.

## Fail-closed execution

The authenticated endpoint re-fetches the GitHub head, GraphQL mergeability and
merge state, exact-head check runs, suites, and legacy statuses. It rejects
unknown, mismatched, failed, cancelled, incomplete, skipped, neutral or pending
required evidence. It also rejects missing owner-configured required checks and
incomplete check pagination. A full observed check suite with zero runs is not
an independent passing check. The final GitHub squash merge supplies the
expected head SHA so a concurrent update fails instead of merging unverified
code.

A pre-existing `minimum_reviews` database column is retained temporarily for
schema compatibility, but the merge endpoint never reads it, owner policy
updates persist zero, and the owner dashboard no longer offers this setting.
A legacy API caller attempting to set a nonzero review count is rejected.

Repository policy changes remain private and owner-authenticated. Authorized
denials and successful merges retain concise audit evidence. Human-only tasks
such as spending, account or credential provisioning, legal decisions and
production access still require their separate permissions; the standing merge
authorization does not approve those actions.

## Outside Boardroom

A direct GitHub merge must apply the equivalent fail-closed, current-head
preflight documented in `docs/GITHUB_MERGE_PREFLIGHT.md`. GitHub permission
and branch-protection enforcement still govern whether it can complete.
