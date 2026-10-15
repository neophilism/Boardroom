# BR-037 — Authoritative GitHub PR and CI evidence

After an authenticated named agent has an active exclusive repository lease, it may call:

`GET /api/v1/github/pr-evidence?runId=<uuid>&generation=<lease>&number=<PR number>`

The endpoint verifies ownership of the current work unit, repository and branch. It refuses to inspect unrelated PRs. GitHub App API calls retrieve the PR's real head SHA, current state, check-run results and legacy commit statuses. It reports OBSERVED_PASS, FAILED, PENDING, REVIEW, NO_CHECKS, or INCOMPLETE, with links to check evidence.

Each response records when the evidence was collected and the exact repository, head SHA and GitHub REST paths used. Check-run start/completion timestamps, legacy-status timestamps and the PR update timestamp are normalized to UTC when GitHub supplies them. Invalid or absent timestamps remain `null`; Boardroom does not invent them.

The response also carries the assigned unit's source-owned acceptance criterion and bounded verification statements from the imported canonical PR registry, together with the plan observation timestamp. These requirements remain separate from observed test results. `unitAcceptance.satisfied` stays false because a passing check set alone cannot prove every acceptance requirement.

**OBSERVED_PASS means only that every *observed* check and status context passed.** It does not verify branch protection, required checks, reviewer approvals, test adequacy, architectural compatibility, or that the approved work unit is complete. The response always says `safeToAutoMerge:false`. BR-038 owns merge/review policy enforcement.

If more than 100 check runs exist for the head, this version reports INCOMPLETE rather than silently treating a truncated first page as all checks passed. No GitHub App or user credential is exposed in the response.
