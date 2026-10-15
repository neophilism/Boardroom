# Fail-closed PR merge preflight

For repositories whose branch rules cannot enforce CI (notably private repositories on unsupported GitHub plans), **never interpret the presence of a merge button, a documentation-only diff, or a CI capacity failure as passed tests**.

Preferred path: use Boardroom's authenticated `/api/v1/github/merge` endpoint, which already requires current-head green checks and configured required contexts.

The endpoint evaluates authoritative check suites, check runs, and legacy statuses. It also requires server-derived repository and deterministic work-branch scope, the caller's exact expected head, clean GitHub merge state, configured required contexts, current-head reviews, live prerequisites, and owner-enabled repository policy. A denied authorized preflight writes a `github.pr.merge_denied` audit event with only the unit, PR, head SHA, and deduplicated blocker codes; no credential or request body is recorded. Boardroom fails closed if that audit cannot be persisted.

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
