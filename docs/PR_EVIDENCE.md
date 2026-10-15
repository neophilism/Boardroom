# BR-037 — Authoritative GitHub PR and CI evidence

After an authenticated named agent has an active exclusive repository lease, it may call:

`GET /api/v1/github/pr-evidence?runId=<uuid>&generation=<lease>&number=<PR number>`

The endpoint verifies ownership of the current work unit, repository and branch. It refuses to inspect unrelated PRs. GitHub App API calls retrieve the PR's real head SHA, current state, check suites, check runs and legacy commit statuses. It reports OBSERVED_PASS, FAILED, PENDING, REVIEW, NO_CHECKS, or INCOMPLETE, with links to check evidence.

Each response records when the evidence was collected and the exact repository, head SHA and GitHub REST paths used. Suite creation/update, check-run start/completion, legacy-status and PR timestamps are normalized to UTC when GitHub supplies them. Invalid or absent timestamps remain `null`; Boardroom does not invent them.

The response also carries the assigned unit's source-owned acceptance criterion, state and bounded verification statements from the imported canonical PR registry, together with the plan observation timestamp. `safeToMarkComplete` and `unitAcceptance.satisfied` are true only when all authoritative CI evidence is observed green, the unit is already explicitly `ACCEPTED`, and non-empty acceptance criteria are recorded. Failed, pending, truncated or review-required evidence therefore cannot be presented as completion.

**OBSERVED_PASS means only that every *observed* suite, check run and status context passed.** It does not verify branch protection, required-check policy, reviewer approvals, test adequacy, architectural compatibility, or independently prove that the approved work unit is complete. The response always says `safeToAutoMerge:false`. BR-038 owns merge/review policy enforcement.

If more than 100 check runs or check suites exist for the head, this version reports INCOMPLETE rather than silently treating a truncated first page as all checks passed. No GitHub App or user credential is exposed in the response.
