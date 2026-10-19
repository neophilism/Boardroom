# Automated dependency PR maintenance

The owner directs Boardroom to stop requesting `neophilism` as a routine pull-request reviewer. This applies equally to Boardroom agents and Dependabot. The installed scheduled-agent instructions and the server-supplied `boardroom_profile` instruction carry the same policy. A GitHub banner saying a PR is "waiting on your review" may simply mean that someone requested review; it does not establish that a human approval is a legal or technical prerequisite.

## Scheduling and scope

The existing signed `boardroom-maintenance` GitHub workflow runs a private authenticated `/api/v1/internal/tick` approximately every ten minutes (GitHub cron is best-effort). Each tick claims **at most one** enabled, unarchived, installed/registered owner's repository that has not had this maintenance claim in the last twelve hours. It skips repositories with active Boardroom leases, honors the global pause and uses only the Boardroom GitHub App. A PostgreSQL advisory transaction lock and immutable audit events prevent concurrent duplicate scan claims. No additional ChatGPT scheduled task or paid model call is required.

The scanner considers at most twenty open PRs in the selected repository. It removes an owner review *request* only when the author is authenticated as `dependabot[bot]` (verified GitHub account ID) or `boardroom-coordinator[bot]`. It never dismisses submitted reviews, grants approvals, disables review rules, or modifies an unrelated contributor's PR.

## Merge rules

Only authenticated Dependabot PRs are candidates for unattended merging. The PR must target the repository's actual default branch with an in-repository `dependabot/` head, pass fresh GitHub source identity and mergeability checks, and touch **only** existing `package.json` manifests and one supported JS lockfile. JSON manifests are compared before/after at their exact commits. The only permissible changes are pinned semantic version **patch** increases (up to three dependency entries), with no script, metadata, added dependency, removed dependency, or `@types/node` change.

Before the merge the scanner verifies all current-head check runs and check suites completed successfully, including a meaningful CI/verify/test/build check and all reported legacy statuses. Missing, pending, skipped, failed, truncated or contradictory evidence blocks merging. GitHub itself must report `mergeable=true` and `mergeable_state=clean`. Merges are squash-only and conditioned on the exact SHA. At most one dependency PR is merged per scanned repository, allowing ordinary main-branch CI to finish before another.

The owner can pause execution using Boardroom's existing execution control; the GitHub repository's own protection and required reviewer rules remain authoritative. No other PR category, semver minor/major, incompatible typing/runtime change, unverified bot, or workflow/action edit is merged by this scanner. The scanner does not interpret PR text as operational instructions.

## Agent escalation (not owner escalation)

Unsupported, ambiguous and major/minor dependency updates remain open and are recorded with a minimal `maintenance.dependabot.needs_agent` audit event. Engineering agents should investigate when authorized for the affected repository, run actual compatibility and security tests, update code or use a separate approved branch/PR if necessary, and merge through the existing guarded workflow after the new exact head passes CI. They must never send routine PRs to the owner just because Dependabot created them. Genuine permissions, secrets, spending, legal or externally required branch approvals remain separate blockers and must not be fabricated or bypassed.

The scan records started/completed, merge-intent/confirmed and deferred work in Boardroom's private audit table. If a GitHub response is lost after a merge attempt, no immediate blind replay occurs; a later scan reads the authoritative live PR state. Monitor the maintenance GitHub Action, internal tick results and private audit events for installation authorization errors. A policy file committed to a repository is not evidence that the production maintenance workflow has deployed; verify the actual service revision before claiming production activation.
