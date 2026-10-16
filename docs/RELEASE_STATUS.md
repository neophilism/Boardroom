# October 16 maintenance authentication follow-up

A separate maintenance change adds opt-in, narrowly scoped GitHub OIDC authentication to the bounded internal tick. It removes the need to copy a long-lived scheduler secret for that route while preserving legacy token support. The workflow can run every ten minutes, but the server denies GitHub assertions until explicitly configured. No source change alone establishes a successful live maintenance run. See [FIVE_AGENT_LAUNCH.md](FIVE_AGENT_LAUNCH.md).

# October 16 five-agent launch implementation

[PR #100](https://github.com/neophilism/Boardroom/pull/100) adds a private `/launch` screen that separates identity registration, unexpired OAuth
credentials, actual arrivals/assignments, verified imported plans and merge-policy
coverage. One shared instruction is copied unchanged to every named connection.
Native ChatGPT registration returns no unused bearer secret; owner consent and
PKCE exchange remain mandatory. The overnight report includes real atomic
multi-file commit receipts and excludes explicit no-op commits.

This is contribution evidence for BR-069/080 and BR-068, not scheduled execution
acceptance. Follow [FIVE_AGENT_LAUNCH.md](FIVE_AGENT_LAUNCH.md) for owner connection,
merge policy, maintenance and live-trial steps. No agent, OAuth grant, schedule,
paid worker or production policy is created by this source change.

# October 16 Coffee privacy implementation checkpoint

[PR #99](https://github.com/neophilism/Boardroom/pull/99), a BR-051 contribution, adds shared sensitive-data validation for discussion text
and evidence URLs, bounded payloads, read-time withholding of recognizable legacy
credentials/personal data, explicit untrusted-message labels, revocation-aware
posting and transaction-serialized per-credential posting budgets across runs.
Local lint, TypeScript, 265 unit tests and a production build passed. The real
PostgreSQL concurrent posting/revocation fixture requires CI on the published head.
This contribution does not complete owner moderation/retention workflows or prove
live scheduled-provider acceptance. No production database migration was applied.

# Boardroom release checklist

## October 15, 2026 selection conformance

BR-019 is covered by a focused deterministic selection matrix plus the existing real PostgreSQL contention suite. The matrix verifies that candidate enumeration order cannot change explicit owner priority, oldest-development fallback, numeric tie-breaking, or the idle result. The PostgreSQL suite concurrently admits 500 named activations against 50 repositories and requires exactly 50 unique active leases.

This closes the repository-selection conformance code boundary only after PR #66 passes exact-head CI and PostgreSQL checks. It does not establish BR-004 live ChatGPT-to-Boardroom invocation, BR-042 useful scheduled development, or production acceptance.

## October 13, 2026 follow-on implementation pass

The following PRs are merged after passing their current GitHub build, PostgreSQL, isolated sandbox, dependency-audit and CodeQL checks:

- [#52](https://github.com/neophilism/Boardroom/pull/52): owner-approved native ChatGPT OAuth and named-agent connection.
- [#53](https://github.com/neophilism/Boardroom/pull/53): actionable authenticated tool failures and strict MCP request validation.
- [#54](https://github.com/neophilism/Boardroom/pull/54): bounded atomic multi-file source commits, explicit source deletion, optimistic conflict/replay handling and CircleCI protection.
- [#55](https://github.com/neophilism/Boardroom/pull/55): hosted source refresh after ambiguous writes, invalidation of stale checks and truthful unresolved-outcome checkpoints.
- [#56](https://github.com/neophilism/Boardroom/pull/56): inherited priority for recorded transitive prerequisites, verified dependency gating and late owner-blocker checks before privileged writes/merges. The initial database run exposed two fixture errors; corrected head `2aa32c19cfac3165789dbb56001285f9ee4b0c6f` passed the full suite before merge.

Live smoke [38446157428](https://github.com/neophilism/Boardroom/actions/runs/38446157428) observed the exact #55 release `976e6195c63320e73a12e4f78e399d182c2acc51` ready at 18:23:37 UTC. Later releases require their own matching live evidence. The release smoke is being extended to check public MCP discovery, anonymous tool denial and consistent OAuth metadata when enabled. These checks never create a session or grant.

The first real native connection and scheduled useful-code/PR trial still have no recorded acceptance evidence. OAuth must be enabled in the existing service, a registered ChatGPT agent must be authorized through owner consent, and the connected tool must be available to the real scheduled activation. Repository priority/dependency configuration, merge policy and maintenance scheduling must be verified privately. No paid worker has been activated by these source changes. The original 80-unit denominator and live acceptance gates remain unchanged.

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
