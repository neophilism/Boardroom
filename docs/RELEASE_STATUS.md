# Boardroom release checklist

## October 13, 2026 checkpoint

PR #42 is merged: `bd7973207ef2f88d4438bbcc56d752b1cd78102e`.

Verified before merge:
- [CI](https://github.com/neophilism/Boardroom/actions/runs/38323629955).
- [PostgreSQL concurrency](https://github.com/neophilism/Boardroom/actions/runs/38323629922).
- [Isolated coding harness](https://github.com/neophilism/Boardroom/actions/runs/38323629948).
- [Security analysis](https://github.com/neophilism/Boardroom/actions/runs/38323629962).
- Migration 0006 applied transactionally on an isolated child branch of the existing Neon database; six-entry ledger, seven execution tables and invalid-state rejection verified. Exact evidence is in [PR #42](https://github.com/neophilism/Boardroom/pull/42).

This is implementation/infrastructure evidence, not completion of BR-004, BR-042 or BR-078. The 80 approved units remain the canonical scope; supporting/follow-up PRs must not inflate that denominator.

## Critical path to the first working unattended loop

| Gate | Remaining proof | Where to perform it |
| --- | --- | --- |
| Deployed release | Exact current commit live; six required migrations match source; readiness succeeds | Render service, `/api/health`, `/api/ready`, private `/system` |
| GitHub onboarding | Installed App has required permissions and inventory imports genuine approved plans | Private `/system` and Work Board |
| Agent authentication | At least one exact roster identity is bound to a credential in a supported private connection | Private `/agents` and connector/worker secret store |
| Supported activation | Real scheduled ChatGPT tool invocation, or an explicitly labeled hosted-worker trial | BR-004/005 evidence; no fabricated scheduled result |
| Development loop | Exclusive claim, useful change, isolated checks, mapped PR, current-head CI/review, checkpoint and release | BR-042 evidence with actual run and PR references |
| PR chaining | Same session completes and advances through successive eligible approved units in one repository | BR-039/041; owner merge policy and current-head requirements enforced |
| Interruption safety | Old execution confirmed stopped or isolated; stale writes rejected; checkpoint safely resumed | BR-053/054/060 |
| Human escalation | Genuine private Owner Action, verified resolution and requeue; evidence-based Coffee answer | BR-029/050/063 |

## Full-scope completion still requires acceptance

The first loop does not complete the whole roadmap. Multi-source onboarding and provider conformance, production-scale benchmarks, Engine Room's separately tracked consumer integration, consolidated digests/notifications, security/privacy review, backup/restore and service-capacity/rollback evidence remain subject to their individual acceptance criteria. Some have implemented foundations; none should be marked complete solely because a similarly titled PR merged.

Configuration and paid-runtime activation require the owner's existing approval boundaries. Never request raw secrets in chat, create substitute infrastructure for failed account access, or mark live integration evidence based on mocks or CI-only fixtures.
