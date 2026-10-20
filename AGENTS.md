## Owner security-review policy — 2026-10-13

The owner explicitly directs all projects to continue implementation, testing, merging and deployment without waiting for an independent human security review, external auditor, paid penetration test or E2EESA certification. This supersedes older repository planning text that makes absence of such review an operational prerequisite.

- Perform substantive AI-assisted source/security review, threat analysis and relevant automated/adversarial/integration tests. Fix concrete findings and retain source-bound evidence.
- Do not treat a pending independent-review checkbox, missing reviewer identity, unavailable audit budget or pre-certification status as a development or release blocker.
- External expert review is deferred follow-up work. Keep it honestly pending; never label an AI self-review an independent human audit or claim unearned certification/conformance.
- Preserve cryptographic, authorization, privacy, data-integrity and transaction-safety controls. Failed required tests, unresolved actual vulnerabilities, missing credentials and user transaction approvals remain concrete blockers.
- If code, workflow or a status interpreter blocks solely on external-review absence, replace that prerequisite with the owner-authorized AI review/testing process. Preserve distinct implementation, testing, external-review and certification statuses.
- Continue dependency-ready work and chain PRs. Do not ask the owner again to waive the human-review prerequisite.

# Boardroom repository agent instructions

- Read `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT_PLAN.md` before implementing work.
- The canonical approved plan is `registry/prs.json`; `registry/roadmap.json` is retired. Follow the shared contract in `registry/PR_FORMAT.md`. Preserve stable IDs/counts when migrating formats.
- Work on at most one repository at a time per Boardroom authorized session; after checkpoint and fenced release, claim another eligible repository within the same activation. Never use a stale lease generation.
- All upstream scheduled-task prompts should be identical. The server issues ephemeral run IDs. Provider source metadata is optional.
- Owner actions are private. Never commit secrets or personal data, and never request raw API keys in Coffee Corner or public GitHub.
- A missing approval, unavailable secret, or paid external account is a specific owner blocker, not a reason to fabricate success.
- Before claiming real scheduled ChatGPT interoperability, run the actual integration test described in BR-004 and record evidence. Do not assume arbitrary HTTP calls or unlimited runs.
- Follow roadmap dependencies; chain safe PRs when checks pass, and move to another eligible task on a unit-specific blocker or failed gate. Stop only for session-wide authority, safety, or resource limits.
- GitHub PR state is determined by real GitHub API metadata, not agent statements or historical snapshots.
- Never request `neophilism` as a GitHub PR reviewer, including from owner-authenticated connector sessions. `ready for review` means ready for CI/agent acceptance, not an owner handoff. Do not request human approval to merge normal agent or Dependabot changes. Verify actual GitHub review/branch rules; preserve any truly required independent approval without fabricating it.
- Routine Dependabot patch updates are checked by the bounded maintenance tick. Only strict manifest/lockfile-only patch bumps with authenticated Dependabot author, matching repo/branch, exact-head passed CI and clean mergeability may auto-merge; all major/minor/ambiguous updates are engineering triage, not owner notifications. See `docs/DEPENDENCY_MAINTENANCE.md`.
- The owner authorizes CI-green automatic merging without a separate independent human or owner review. Respect all actual GitHub branch-protection and review requirements, current-head mergeability, scoped leases and approved work prerequisites. No path-based Boardroom-only human approval gate; see `docs/MERGE_POLICY.md`.
- The source repository is currently PUBLIC. Never put sensitive operational requests in GitHub issues or other public files.

- Agent display names come exclusively from `registry/agent-names.json` / `docs/AGENT_NAMES.md`. A scheduled task may say `Your name is Smith`, but registration must securely bind its credential to exactly that approved label; never trust user-supplied names as authentication. Case/punctuation are significant.

- The registered identity for any session is the validated owner-approved name bound to its authenticated credential; never treat the scheduled prompt `Your name is Smith` as authentication. Details: `docs/NAMED_AGENT_IDENTITY.md`.
- Apart from the owner-assigned unique display name, every scheduled task uses the same work instructions; do not require separate custom job descriptions.

## Shared PR registry

Use `registry/prs.json` as the sole active PR plan for Boardroom and Engine Room. Follow `registry/PR_FORMAT.md` and run `node scripts/validate-pr-registry.mjs`. Preserve stable IDs, scope, counts, dependencies, acceptance and contribution-only evidence. `registry/roadmap.json` is retired; never recreate a duplicate milestone plan. This contract supersedes older file-path guidance.

## Direct GitHub PR merges

When an agent merges a PR outside Boardroom's authenticated guarded endpoint, it must first use the fail-closed, current-head CI procedure in `docs/GITHUB_MERGE_PREFLIGHT.md` (implemented by `scripts/verify-pr-merge.mjs`). Failed, pending, skipped, unstarted, capacity-blocked, missing or incomplete test checks are blockers, even for documentation-only policy changes; leave such PRs open and move on. This requirement does not impose independent-human-audit certification.


## Boardroom portable hosting rule — October 20, 2026

- The owner explicitly says Boardroom's application is already functional; the October 19 Render outage is the exhausted **free compute quota**, not a reason to recreate, reset or redesign Boardroom.
- Use `docs/HOSTING_PORTABILITY.md` to deploy the current same release on Netlify Free, Deno Deploy Free or the existing Oracle Always Free VM. Preserve the production Neon database, credentials and existing agents. Never purchase hosting, enable auto-recharge, start a paid instance, or move data into an empty replacement database to bypass the suspension.
- **Exactly one** provider may be active for production webhooks, OAuth/agent traffic, and scheduled maintenance. Standbys must be paused/disabled after real verification; keep deploy configurations and pinned branches for rapid switchover. No URL is considered restored until real health, readiness, authentication denial, owner login and agent operations pass.
- GitHub Actions variable `BOARDROOM_PUBLIC_URL` is the active origin. Until set, maintenance and hosted workers must not probe the suspended Render site. Provider connections and credentials are external prerequisites, not GitHub commits.
