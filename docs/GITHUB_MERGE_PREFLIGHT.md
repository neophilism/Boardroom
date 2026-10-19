# Fail-closed PR merge preflight

For repositories whose branch rules cannot enforce CI (notably private repositories on unsupported GitHub plans), **never interpret the presence of a merge button, a documentation-only diff, or a CI capacity failure as passed tests**.

Preferred path: use Boardroom's authenticated `/api/v1/github/merge` endpoint, which already requires current-head green checks and configured required contexts.

For an authorized manual/CLI merge outside that endpoint, use the reviewed script in this repository:

```sh
# Read-only verification (default). The target project must have actual passing checks.
GH_TOKEN=... node scripts/verify-pr-merge.mjs \
  --repo owner/repository --pr 123 \
  --require 'verify' --require 'ci/circleci: browser' \
  --expected-sha FULL_40_CHARACTER_HEAD_SHA

# Only after successful read-only inspection, with the same required checks:
GH_TOKEN=... node scripts/verify-pr-merge.mjs \
  --repo owner/repository --pr 123 \
  --require 'verify' --require 'ci/circleci: browser' \
  --expected-sha FULL_40_CHARACTER_HEAD_SHA --merge
```

Set `GH_TOKEN` or `GITHUB_TOKEN` as an environment secret using a fine-grained token with the minimum permissions for the particular repository. **Never paste tokens into commands, source code, PR comments, or logs.** The example above illustrates the environment-variable name, not a literal token command to paste.

The command checks the PR's exact commit SHA, GitHub mergeability, completed checks, legacy CircleCI statuses, and named required checks. It fails closed for no tests, incomplete results, skipped tests, pending checks, and ANY failing check (including GitHub Actions jobs that never started). It repeats the preflight and uses GitHub's expected-SHA merge constraint before a squash merge. Output excludes credentials.

Important limitations: This is an **agent workflow and CLI safeguard**, not GitHub branch protection. A user or API client who bypasses it can still merge if their GitHub permissions allow that. Enable repository branch protection or repository rulesets with required test checks when the GitHub plan permits it. Neither human-audit certification nor a paid external security review is a prerequisite; actual CI correctness is.

For historic policy rollout PRs merged without completed tests, treat the runtime as **unverified**, record the exact PR and affected checks, and schedule genuine CI when capacity exists. An `AGENTS.md`-only diff is not evidence that preexisting software passes its tests. Do not revert correctly written policy text in an attempt to erase a CI status.

## Automated dependency updates

Boardroom's authenticated maintenance tick has a separately bounded Dependabot hygiene pass (`src/server/dependency-maintenance.ts`). It removes accidental owner review requests on verified Dependabot and Boardroom-coordinator PRs. It considers **only exact pinned semver patch updates** with changes restricted to package manifest versions and a single lockfile. It checks GitHub's actual author ID, repository/base/head identity, exact-current-head successful CI, and clean mergeability, and passes the SHA to the merge API. It processes at most one patch merge per repository per cycle and will not merge a repo under an active Boardroom lease or while execution is paused. Major/minor updates, Node runtime/type mismatches, missing/pending CI and ambiguous file changes are left for agents to investigate, not sent to the owner for approval.

This is not an exception to GitHub's actual branch protection, required reviews, or dependency vulnerability checks. The maintenance tick is an authorized, narrow bot-only write path; general code PRs continue through the fenced merge gateway above.
