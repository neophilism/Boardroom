# BR-037 — Authoritative GitHub PR and CI evidence

After an authenticated named agent has an active exclusive repository lease, it may call:

`GET /api/v1/github/pr-evidence?runId=<uuid>&generation=<lease>&number=<PR number>`

The endpoint verifies ownership of the current work unit, repository and branch. It refuses to inspect unrelated PRs. GitHub App API calls retrieve the PR's real head SHA, current state, check-run results and legacy commit statuses. It reports OBSERVED_PASS, FAILED, PENDING, REVIEW, NO_CHECKS, or INCOMPLETE, with links to check evidence.

**OBSERVED_PASS means only that every *observed* check and status context passed.** It does not verify branch protection, required checks, reviewer approvals, test adequacy, architectural compatibility, or that the approved work unit is complete. The response always says `safeToAutoMerge:false`. Follow-up BR-038 must implement the merge/review policy and prove its enforcement.

If more than 100 check runs exist for the head, this version reports INCOMPLETE rather than silently treating a truncated first page as all checks passed. No GitHub App or user credential is exposed in the response.
