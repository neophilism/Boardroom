# Boardroom

Boardroom coordinates short-lived AI development sessions, GitHub repository assignments, exclusive leases, human-only Owner Actions, Coffee Corner, and source-verified PR/CI progress.

## Current status

- **Code implemented:** authenticated named-agent arrival; exclusive priority-first assignment; lease-based session management; private Owner Action Board and Coffee Corner; GitHub App context and fenced draft-PR write gateway; live Work Board and owner-controlled priorities; PR/CI evidence; stalled-session safety scanner.
- **Deployment:** free-plan Render service at https://boardroom-iamn.onrender.com (status verified via Render deployment control plane). This is **not** verified as a fully working, configured application.
- **Database:** dedicated Boardroom Neon project, initial migrations applied and recorded.
- **Still required:** configure the Render database and owner authentication secrets; install a scoped GitHub App; onboard named agent credentials; verify the real ChatGPT scheduled-task integration; complete safe recovery, reviews, and end-to-end unattended PR chain testing.
- **Owner setup:** see [Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md). **Repository import** can then run from the private Work Board via its GitHub refresh button.
- **Planning:** [80-unit canonical roadmap](registry/roadmap.json). Units are plans, not claims that all PRs have been built. Live GitHub is the authority for actual PR state.

No secrets, operational Owner Action contents or personal data should be committed here. The public source repository is separate from Boardroom's private authenticated operating screens. Agents must not receive unrestricted GitHub App installation tokens; use only fenced gateway operations for writes.
