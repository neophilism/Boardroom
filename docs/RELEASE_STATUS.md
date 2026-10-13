# Boardroom release checklist

## October 13, 2026 checkpoint

PR #42 is merged at `bd7973207ef2f88d4438bbcc56d752b1cd78102e`. PR #44 is merged at `b18660881aea234a7e9a8d153b7c176839d69530`.

Verified implementation and infrastructure evidence:
- PR #42 passed [CI](https://github.com/neophilism/Boardroom/actions/runs/38323629955), [PostgreSQL concurrency](https://github.com/neophilism/Boardroom/actions/runs/38323629922), [isolated coding harness](https://github.com/neophilism/Boardroom/actions/runs/38323629948) and [security analysis](https://github.com/neophilism/Boardroom/actions/runs/38323629962).
- Migration 0006 passed isolated Neon child-branch validation. A subsequent read-only production check at 15:31 UTC confirmed all six migrations and the exact 0006 source hash.
- The second attempt of [live smoke run 38422077086](https://github.com/neophilism/Boardroom/actions/runs/38422077086), job 115385388267, observed the exact PR #42 release at 15:33:53 UTC with readiness `ready` and anonymous owner-route denial.
- PR #44 requires all six exact migration fingerprints, checks the manifest against the actual SQL inventory, and prevents incomplete or incorrect schema evidence from verifying owner setup. Its final head passed [CI](https://github.com/neophilism/Boardroom/actions/runs/38423268395), [PostgreSQL concurrency](https://github.com/neophilism/Boardroom/actions/runs/38423268384), [isolated sandbox](https://github.com/neophilism/Boardroom/actions/runs/38423268418) and [security analysis](https://github.com/neophilism/Boardroom/actions/runs/38423268443).

The first smoke run after each merge observed the previous healthy revision. Those historical green results are not evidence that the newly merged release was live. The release workflow now supplies the intended Git SHA and requires matching liveness metadata plus HTTP 200 readiness, with bounded deployment retries. A newer main push supersedes an older pending release check. A manual run without an expected revision is monitoring only and cannot establish release acceptance.

This is implementation/infrastructure evidence, not completion of BR-004, BR-042 or BR-078. The 80 approved units remain the canonical scope; supporting/follow-up PRs must not inflate that denominator.

## Critical path to the first working unattended loop

| Gate | Remaining proof | Where to perform it |
| --- | --- | --- |
| Current deployed release | Latest intended SHA matches live service; all required migrations match source; readiness succeeds | Strict live release workflow and private `/system` |
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
