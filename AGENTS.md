# Boardroom repository agent instructions

- Read `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT_PLAN.md` before implementing work.
- The canonical approved plan is `registry/roadmap.json`; `registry/prs.json` is a compatibility projection, not a competing set of work. Keep stable IDs/counts synchronized whenever approved scope changes.
- Work on at most one repository per Boardroom authorized session; use atomic claims and verify fencing at every privileged GitHub write.
- All upstream scheduled-task prompts should be identical. The server issues ephemeral run IDs. Provider source metadata is optional.
- Owner actions are private. Never commit secrets or personal data, and never request raw API keys in Coffee Corner or public GitHub.
- A missing approval, unavailable secret, or paid external account is a specific owner blocker, not a reason to fabricate success.
- Before claiming real scheduled ChatGPT interoperability, run the actual integration test described in BR-004 and record evidence. Do not assume arbitrary HTTP calls or unlimited runs.
- Follow roadmap dependencies; chain safe PRs when checks pass, and stop on material blockers or failed required gates.
- GitHub PR state is determined by real GitHub API metadata, not agent statements or historical snapshots.
- The source repository is currently PUBLIC. Never put sensitive operational requests in GitHub issues or other public files.

- Agent display names come exclusively from `registry/agent-names.json` / `docs/AGENT_NAMES.md`. A scheduled task may say `Your name is Smith`, but registration must securely bind its credential to exactly that approved label; never trust user-supplied names as authentication. Case/punctuation are significant.
