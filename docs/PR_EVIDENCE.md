# BR-037 — Authoritative GitHub PR and CI evidence

After an authenticated named agent has an active exclusive repository lease, it may call:

`GET /api/v1/github/pr-evidence?runId=<uuid>&generation=<lease>&number=<PR number>`

The endpoint verifies ownership of the current work unit, repository and branch. It refuses to inspect unrelated PRs. GitHub App API calls retrieve the PR's real head SHA, current state, check suites, check runs and legacy commit statuses. It reports OBSERVED_PASS, FAILED, PENDING, REVIEW, NO_CHECKS, or INCOMPLETE, with links and source timestamps where GitHub supplies them.

The response also carries the approved roadmap unit's acceptance criteria, Boardroom acceptance state and source-observation timestamp. `safeToMarkComplete` is true only when all authoritative CI evidence is observed green, the unit is already in the explicit `ACCEPTED` state, and non-empty acceptance criteria are recorded. Failed, pending, truncated or review-required evidence therefore cannot be presented as completion.

**OBSERVED_PASS means only that every *observed* suite, check run and status context passed.** It does not verify branch protection, required-check policy, reviewer approvals, test adequacy, architectural compatibility, or independently prove the approved work unit is complete. The response always says `safeToAutoMerge:false`. Follow-up BR-038 must implement the merge/review policy and prove its enforcement.

The `provenance` object names the GitHub App API and Boardroom roadmap unit resources and records when the evidence was observed. PR, check-run and legacy-status timestamps remain attached to their originating records. If more than 100 check runs or check suites exist for the head, this version reports INCOMPLETE rather than silently treating a truncated first page as all checks passed. No GitHub App or user credential is exposed in the response.
