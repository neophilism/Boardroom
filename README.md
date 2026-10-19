# Boardroom

Boardroom coordinates short-lived AI development sessions, exclusive GitHub repository assignments, private Owner Actions, Coffee Corner and source-verified PR/CI progress.

## Current release status

The execution batch in [PR #42](https://github.com/neophilism/Boardroom/pull/42) was merged on October 13, 2026 after its CI/security gates and isolated Neon migration validation passed. It adds a bounded hosted coding runner, provider-neutral MCP tools, current-head merge checks, same-repository PR chaining, usage limits, recovery controls and webhook reconciliation to the existing owner dashboard and named-agent APIs.

**Merged code is not a verified unattended production system.** See the [release checklist](docs/RELEASE_STATUS.md) for the remaining live integration gates and evidence. The previous Neon authentication failure is no longer the migration-validation blocker; actual deployment and configured-worker acceptance must be checked separately.

- Application: https://boardroom-iamn.onrender.com. Private operating screens require owner authentication. A historical successful deployment does not prove the latest revision is live.
- Five named workers: [Launch checklist and shared instructions](docs/FIVE_AGENT_LAUNCH.md), available privately at `/launch`.
- Setup and verification: [Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md).
- Worker activation and cost controls: [Hosted Worker Setup](docs/HOSTED_WORKER_SETUP.md).
- Integration contract: [Execution Protocol](docs/EXECUTION_PROTOCOL.md).
- Approved scope: [118-unit canonical roadmap](registry/prs.json). Planned units are not completed PRs; GitHub's live metadata is authoritative for merges.

Never commit credentials, private operational requests or personal data. Agents receive scoped, fenced capabilities, not unrestricted GitHub installation tokens. Hosted jobs remain opt-in; no CI result authorizes spending or establishes native ChatGPT scheduled-task compatibility.

## Manual robot-to-project status

Owner-only `/agent-status` presents each registered agent and reserved name, the provider account, current verified lease/project, work unit, heartbeat and last completed project. It queries Neon **only when the page is opened or its Refresh button is clicked** (no client polling or periodic worker activation). Reservations are stored privately in Neon and do not issue credentials or schedules. See `docs/AGENT_STATUS.md`.
