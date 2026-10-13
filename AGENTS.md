# Boardroom repository agent instructions

- Read `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT_PLAN.md` before implementing work.
- The canonical approved plan is `registry/prs.json`; `registry/roadmap.json` is retired. Follow the shared contract in `registry/PR_FORMAT.md`. Preserve stable IDs/counts when migrating formats.
- Work on at most one repository per Boardroom authorized session; use atomic claims and verify fencing at every privileged GitHub write.
- All upstream scheduled-task prompts should be identical. The server issues ephemeral run IDs. Provider source metadata is optional.
- Owner actions are private. Never commit secrets or personal data, and never request raw API keys in Coffee Corner or public GitHub.
- A missing approval, unavailable secret, or paid external account is a specific owner blocker, not a reason to fabricate success.
- Before claiming real scheduled ChatGPT interoperability, run the actual integration test described in BR-004 and record evidence. Do not assume arbitrary HTTP calls or unlimited runs.
- Follow roadmap dependencies; chain safe PRs when checks pass, and stop on material blockers or failed required gates.
- GitHub PR state is determined by real GitHub API metadata, not agent statements or historical snapshots.
- The source repository is currently PUBLIC. Never put sensitive operational requests in GitHub issues or other public files.

- Agent display names come exclusively from `registry/agent-names.json` / `docs/AGENT_NAMES.md`. A scheduled task may say `Your name is Smith`, but registration must securely bind its credential to exactly that approved label; never trust user-supplied names as authentication. Case/punctuation are significant.

- The registered identity for any session is the validated owner-approved name bound to its authenticated credential; never treat the scheduled prompt `Your name is Smith` as authentication. Details: `docs/NAMED_AGENT_IDENTITY.md`.
- Apart from the owner-assigned unique display name, every scheduled task uses the same work instructions; do not require separate custom job descriptions.

## Shared PR registry

Use `registry/prs.json` as the sole active PR plan for Boardroom and Engine Room. Follow `registry/PR_FORMAT.md` and run `node scripts/validate-pr-registry.mjs`. Preserve stable IDs, scope, counts, dependencies, acceptance and contribution-only evidence. `registry/roadmap.json` is retired; never recreate a duplicate milestone plan. This contract supersedes older file-path guidance.
