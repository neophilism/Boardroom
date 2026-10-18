# BR-037 — Authoritative GitHub PR and CI evidence

After an authenticated named agent has an active exclusive repository lease, it may call:

`GET /api/v1/github/pr-evidence?runId=<uuid>&generation=<lease>&number=<PR number>`

The endpoint verifies ownership of the current work unit and repository. It permits the assigned work PR and source-owned `contributingPrs` or `priorEvidencePrs` references from that unit's verified canonical registry. It refuses unrelated PRs, title-only discovered links, mismatched GitHub PR numbers, fork/cross-repository identities and invalid head SHAs. GitHub App API calls retrieve the PR's real head SHA, current state, check suites, check runs and legacy commit statuses. It reports OBSERVED_PASS, FAILED, PENDING, REVIEW, NO_CHECKS, or INCOMPLETE, with links to check evidence.

`pullRequest.relationship` distinguishes `ASSIGNED_WORK`, `CONTRIBUTION` and `PRIOR_EVIDENCE`. Historical references authorize read-only inspection without adding them to the work branch's write/readiness/merge mapping. For example, a unit with `prs:[]` and `contributingPrs:[14,29]` can inspect both contributing PRs while still requiring new work for the unit's remaining acceptance. No evidence read grants write or merge authority.

Each response records when the evidence was collected and the exact repository, head SHA and GitHub REST paths used. The `pullRequest.accepted` field is true when GitHub supplies a valid `merged_at`: **the merge itself accepts the PR**, without a second package review. Suite creation/update, check-run start/completion, legacy-status and PR timestamps are normalized to UTC when GitHub supplies them. Invalid or absent timestamps remain `null`; Boardroom does not invent them.

The response also carries the assigned unit's source-owned acceptance criterion, state and bounded verification statements from the imported canonical PR registry, together with the plan observation timestamp. `safeToMarkComplete` and `unitAcceptance.satisfied` are true only for `ASSIGNED_WORK` when all authoritative CI evidence is observed green, the unit is already explicitly `ACCEPTED`, and non-empty acceptance criteria are recorded. Contributions and prior evidence always return these fields as false, even when their individual PRs have merged and their checks pass. Failed, pending, truncated or review-required evidence therefore cannot be presented as completion.

**OBSERVED_PASS means only that every *observed* suite, check run and status context passed.** It does not verify branch protection, required-check policy, reviewer approvals, test adequacy, architectural compatibility, or independently prove that the approved work unit is complete. The response always says `safeToAutoMerge:false`. BR-038 owns merge/review policy enforcement.

If more than 100 check runs or check suites exist for the head, this version reports INCOMPLETE rather than silently treating a truncated first page as all checks passed. No GitHub App or user credential is exposed in the response.

**Separate scope definitions:** `pullRequest.accepted` describes only the PR; `unitAcceptance.satisfied` and `safeToMarkComplete` refer to the broader assigned work unit and intentionally require distinct completion evidence. A subsequent open follow-up can reopen a planned work unit, but it never revokes an earlier PR's merge or PR acceptance. A live production deployment is a third independent fact.
