# API agents and million-identity expansion — Boardroom v3

**Status:** approved-for-planning work units BR-081–BR-118, October 18, 2026. This document expands, but does not replace, the existing 80-unit canonical roadmap. Exactly **38 additional PR-sized units** are in `registry/prs.json` (118 total); the registry is the sole machine-readable plan. None of these new units should be treated as implemented by virtue of this document. Work is sequential only where dependencies require; multiple independent adapters can proceed in parallel.

## Current system, zero-cost baseline

- Boardroom already includes a bounded hosted runner with OpenAI/Anthropic/xAI HTTP paths (`src/runner/provider.ts`, `src/runner/run.ts`), behind explicit keys and `BOARDROOM_RUN_ENABLED`. These are **foundations**, not a verified production multi-provider platform. Model effort and full provider billing details need hardening.
- Existing named ChatGPT scheduled agents use OAuth/MCP, live Boardroom leases, checkpoints and the exact 601-approved-name roster. **Preserve them.** Scheduled Work credits are not interchangeable with API tokens.
- GitHub Actions currently runs fixed deterministic CI and maintenance; the Boardroom backend performs bounded watchdog/outbox/inventory work without model calls. Maintain this lower-cost division.
- Unfunded default: **zero paid model calls, $0 spending permission, no API agents activated**. Nothing in this PR enables spending, creates cloud infrastructure, configures keys or starts timers.

## Candidate provider integrations — independently versioned

The initial four **frontier-capable families** (availability, benchmarks and prices are versioned, not hardcoded) are:

| Provider | Initial current family to qualify | API interface | Notes |
| --- | --- | --- | --- |
| OpenAI | GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna | Responses API | Effort levels and cache prices are model-specific; high/xhigh/max only where supported |
| Anthropic | Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and economical Haiku | Messages API | Adaptive thinking, native effort, prompt caching and tool result conventions differ |
| xAI | Grok 4.7 and current validated Grok series | Responses API | Validate alias migrations, reasoning and extra tool fees |
| Google | Gemini 4 Argon and current Gemini fast variants | Gemini Interactions/API | Argon supports low/medium/high thinking, long-running responses and implicit caching |

Each must pass an offline conformance harness **before** owner-funds canaries. A dynamic provider registry allows later frontier-qualified candidates (for example DeepSeek, Qwen, Kimi, Mistral or new entrants). A model is not automatically labeled frontier or granted credentials; compare it against relevant task evaluations, reliability, tools, price and data controls. Pin tested versions and treat aliases as potentially changing price/capability.

Up-to-date source documentation (revalidate at implementation time):
- OpenAI models and response/effort: https://developers.openai.com/api/docs/models and https://developers.openai.com/api/docs/guides/latest-model
- Claude models, pricing and capabilities: https://platform.claude.com/docs/en/models/overview
- Grok models and costs: https://docs.x.ai/developers/models
- Gemini models, thinking, rate limits: https://ai.google.dev/gemini-api/docs/models/gemini-4-argon and https://ai.google.dev/gemini-api/docs/rate-limits

### Model choice principle

Do not reduce model quality blindly to save tokens. Calculate **accepted useful work / total cost including retries, review, rework, operational time and escaped defects**, stratified by comparable task complexity. A more expensive model may cost less per accepted outcome. Store requested, actual and provider-native effort separately; `max` on one vendor is not comparable to `high` on another. Preserve owner model overrides. New automatic routing is disabled until held-out evaluations and a rollback gate pass.

## Target architecture and scaling rules

```text
Native ChatGPT scheduled work ---- authenticated MCP ----+
                                                       |
Owner & business policy -> admission / work graph -> durable READY-WORK QUEUE
                                                       |        |
API provider adapters <- stateless, bounded executors <-+        +-> deterministic retry/dead-letter
          |                        |                             |
token/credit usage                scoped tools, sandboxes      webhook/CI triggers
          |                        |
reserve/settle ledger <--- event stream and immutable evidence ---> GitHub/other business apps
          |
tenant/project/agent/role budgets, dashboards, export and owner kill switches

Neon: transactional ownership, reservations, tenant ACLs and metadata.
Partitioned event/analytics store: high-volume traces and historical aggregates.
GitHub Actions: repository CI and bounded maintenance, NOT one paid task per logical agent.
```

- **Logical agent** = long-lived ID/policy/persona and role; **activation** = a temporary job execution. Million logical agents do **not** imply one million processes, cron tasks, API keys, tool sockets or connected ChatGPT accounts.
- **Fencing** = a changed generation invalidates an older worker's authority. **Idempotency** = duplicate queue delivery cannot repeat the same authorized write or paid model request. External paid-call uncertainty must be retained and separately reconciled; do not promise exactly-once provider billing.
- **Sharding** = spreading independently owned agent/job/event keys over multiple database or queue partitions. Use bounded indexed lookups and aggregations; no hourly scan of every agent.
- **Budget authority** = owner-controlled caps that survive restart and contention (global, organization, business, project, task, provider, model, agent and time window). Treat provider invoices as external truth where available. Reserved, calculated, reconciled and unknown charges must never be added as if they were the same measurement.
- **Dispatch** is event-driven (ready work, approvals, CI, incoming support tickets, deadlines), not 1 million hourly chat schedules. One idle registered agent should cost essentially nothing beyond retained metadata.
- **Backpressure** = prevent new jobs when provider capacity, money limits or worker pool is saturated. Queue fairly, shed unimportant load, do not spin agents for retries.
- **Policy isolation**: a support or sales worker does not obtain code, email, payment, customer data or production privilege by default. Each business is a separate tenant/budget/role boundary, with mandatory human authorization for consequential actions.
- **Infrastructure trade-off**: the current Render/Neon deployment is a small-fleet starting point. At extreme scale, queues, storage, tenant partitioning, compute and provider quotas will require separately paid services and stress-tested cluster sizing. A million *simulated registered identities* is a software benchmark, not a million simultaneously executing paid models.

## Fleet metrics and dashboard design

Every event needs `tenant_id, logical_agent_id, activation_id, work_unit_id, provider, model_version, requested_effort, effective_effort, operation_id, trace_id, occurred_at` plus authorization source and allowed provenance-safe status.

| Dashboard element | Visualization | Decision supported |
| --- | --- | --- |
| Account/provider budget runway, reservation headroom | Stacked horizontal spend-versus-budget bars, small multiples by account | Where and when work should pause |
| Token/credit/proxy cost provenance | Stacked ledger waterfall: reserved, calculated, reconciled, unavailable | Avoid false zero or double counting |
| Agent utilization and assignments | Owner-filterable virtualized fleet table; activity/lease states | Spot idle, active, blocked, recovering and zombie work |
| Which robots work on what | Repository/role/team swimlane or Gantt with last verified event | Inspect without continuous polling |
| Usage concentration and spikes | Account × hour heatmap, provider × model treemap | Rebalance high-concentration usage |
| Quality-adjusted efficiency | Cost-versus-accepted-work scatter, matched-difficulty facets | Choose more/less capable models rationally |
| Progress and hidden rework | Funnel: claim → real commit → CI → merge → accepted → production; loop/retry histogram | Detect cheap-looking failures |
| Latency and provider trouble | p50/p95/p99 timelines, quota/429/5xx and circuit-breaker panels | Shift load before API outages |
| Failure causes and alerts | Stacked bars: model, tool, CI, permissions, external owner, money, provider | Fix systemic blockages instead of retrying AI |
| Long-term finances | Daily cost and projected month-end interval chart, by cost center | Fund sustainable growth by business |
| Security and permissions | Risk approval queue and actor/capability graph | Catch over-privileged agents |
| Fleet growth | Registered vs runnable vs running vs useful-throughput curves | Separate impressive headcounts from value |

Default **manual refresh**, with aggregation queries O(number of groups) rather than O(number of displayed logical agents), server-side cursor pagination, coarse views first and optional targeted sampling. Alert only on meaningful budget/risk/availability thresholds; no paid AI monitoring required.

## Minimum release gates — independently verified

**Gate G0 ($0 development):** Code, migrations, exhaustive fake API provider fixtures, stopped-by-default flags, zero outbound model requests, audited owner controls and fully green CI. Never request paid credentials for routine mock tests.

**Gate G1 (funded canary):** Only after explicit owner financing/key provision, authorize one narrowly capped live activation per selected vendor. Record provider request IDs, actual usage, verified work result, settled charge versus provider billing, kill switch and recovery. A green mock is not a green live provider test.

**Gate G2 (first 100 / 1,000 active):** Test safe dynamic concurrency, quota governors and accepted work quality. Publish per-tenant capacity, observed cloud expenses and error budgets, then raise limits only by permission.

**Gate G3 (10,000 simultaneous synthetic jobs):** Distributed load and failure testing across queues/shards/observability. All paid provider transport mocked, no double GitHub writes or false invoice charges, latency and memory measurements published.

**Gate G4 (1,000,000 registered logical identities):** Bulk-provision benchmark with a representative skew of idle, active, blocked and event-triggered agents. No per-agent minute polling. Demonstrate bounded query performance, rebalancing, observability and recovery; document exact hardware/cost envelope and limits. Do not claim one million concurrent or production-active agents.

**Gate G5 (business roles):** For every new profession, register allowed tools, privacy/tenant policy, validated task rubric, regulated/human-approval points and relevant supervision. Do not reuse broad developer/GitHub credentials for other roles.

## Explicit budget protections

- Owner can set an optional allocation policy such as a percentage of *actually available discretionary profits*, never automatically calculate permission from gross sales, estimated earnings or a claimed profit figure. Actual spending requires hard dollar caps.
- Every API key is compartmentalized and revocable. Never pool customer finances or provider keys across independent businesses without explicit authority.
- Provider/batch usage and hosting expense may overrun nominal application estimates because provider billing and cloud settlement can lag. State what is reserved, invoiced and uncertain; implement provider-side spend controls where supported.
- Keep both **emergency stop** and **scheduled pause**, with an audit trail. A global stop cancels future scheduling and prevents new model calls, while safely handling in-flight ambiguous operations.
- Keep native scheduled ChatGPT usage visually separate: its plan credits are not API dollar balances; unsupported native per-agent balances remain *Unavailable*.
- The zero-money state is the default for every future deployment, staging run and fork. No “free tier” auto-tests that might unexpectedly bill.

## Dependency-ordered PR work units

Scope, acceptance and verification for each unit below are registered verbatim in `registry/prs.json`. Each PR must run the repository's current-head checks and observe the real security/merge policy. A dependency that requires credentials or funding blocks only the relevant live-canary stage, not mocked code development.


### F9 — Identity, controls and an inherently no-spend API execution foundation (9 PRs)

#### BR-081 — Separate scalable logical agent identity from scheduled worker names

**Dependencies:** BR-005, BR-080. **Priority:** P0.

**Implementation:** Create UUIDv7/ULID logical agent IDs independent from the 601-name human-scheduled roster; map instances, activations, teams and capabilities without minting one GitHub or provider credential per agent.

**Acceptance:** A million synthetic logical agent records can be addressed without any collisions, without weakening existing named OAuth identity or allowing a prompt to set its own identity.

**Verification:** Migration/backfill fixture, duplicate/impersonation tests, existing named-agent regressions

#### BR-082 — Zero-spend global API activation gate and emergency kill switch

**Dependencies:** BR-074, BR-081. **Priority:** P0.

**Implementation:** Default all API execution to DISABLED with $0 paid budget; enforce per-organization and global kill switches before queue claim and before every outbound model call.

**Acceptance:** A fresh install and an old install without explicit owner funding issue zero billable model requests; disabling work fences new calls and safely checkpoints live tasks.

**Verification:** No-key/no-budget negative tests, racing disable test, outbound HTTP spy assert zero paid calls

#### BR-083 — Versioned provider adapter SDK and common interaction protocol

**Dependencies:** BR-072, BR-081. **Priority:** P0.

**Implementation:** Define provider-independent tool-calling, structured output, cancellation, retries, safety and usage envelopes; preserve native protocol differences and model capabilities.

**Acceptance:** Adapter contract passes fake-provider conformance tests and unknown capabilities fail closed.

**Verification:** Contract tests for schema validation, tool IDs, continuation, partial results, cancellation and incompatible models

#### BR-084 — Tenant-scoped credential vault and provider key lifecycle

**Dependencies:** BR-075, BR-081. **Priority:** P0.

**Implementation:** Add owner-only connection metadata with envelope encryption/KMS, secret reference rotation, provider organization segregation and least-privileged worker access.

**Acceptance:** Secrets never appear in public GitHub, owner HTML, trace payloads, logs or another tenant's job; revoked keys cannot start new calls.

**Verification:** Secret-leak red team, rotation/revocation, cross-tenant and no-secret-mount sandbox tests

#### BR-085 — Versioned frontier model catalog and capability qualification

**Dependencies:** BR-083. **Priority:** P1.

**Implementation:** Discover and pin provider/model IDs and deprecations; record observed availability, context, tools, modality, supported effort/caching/batch capabilities and validated regional restrictions.

**Acceptance:** New/retired models do not silently replace an approved workload or change effective reasoning effort without explicit recorded policy.

**Verification:** Schema/capability compatibility fixtures, changing/removed-model fallback tests

#### BR-086 — Normalized append-only usage, cost and credit-provenance ledger

**Dependencies:** BR-074, BR-083. **Priority:** P0.

**Implementation:** Record per-call/provider/model/tenant/agent/task tokens, cache, reasoning when exposed, native credits only when directly supported, tool fees, estimated/settled source, timestamps and pricing version.

**Acceptance:** Every displayed cost is labeled measured, estimated, reconciled or unavailable; per-provider breakdowns preserve original billing evidence.

**Verification:** Duplicate event, missing provider usage, cache/reasoning billing, precision, audit immutability, migration and retention tests

#### BR-087 — Hard payment authority, pre-call reservations and billing reconciliation

**Dependencies:** BR-082, BR-086. **Priority:** P0.

**Implementation:** Atomically reserve pessimistic maximum exposure before calls; enforce global/tenant/project/provider/agent/task budgets, periodic caps and provider-side billing evidence; hold ambiguous charges for reconciliation.

**Acceptance:** Concurrent workers cannot authorize spending above configured limits; no new billable request after cap/kill, and ambiguous failures never silently free reservations.

**Verification:** Real PostgreSQL contention tests, stale fencing, timeout/idempotency, invoice mismatch, rounding and cap-boundary tests

#### BR-088 — Stateless API executor with isolated tools and durable turns

**Dependencies:** BR-055, BR-075, BR-083. **Priority:** P0.

**Implementation:** Extend the existing hosted runner into short-lived restartable agents; isolate sandbox/network/files; checkpoint model continuation, tool request IDs and exact GitHub write evidence.

**Acceptance:** Workers can die between model and tool responses without duplicate paid calls or privileged writes; cancellation and bad tool requests fail closed.

**Verification:** Kill at every await boundary, sandbox escapes, tool allowlist and remote-write outcome reconciliation

#### BR-089 — Unified admission and work queue for native and API-origin agents

**Dependencies:** BR-081, BR-087, BR-088. **Priority:** P0.

**Implementation:** Keep existing ChatGPT scheduled agents unchanged while API activations use the same server-verified work lease, owner priorities, scoped approvals and checkpoint continuation.

**Acceptance:** Simultaneous API/native claims never produce two writable owners of one repository or duplicate authorized work.

**Verification:** Parallel native/API claim harness with Postgres, stale lease, revival and distinct credential tests

### F10 — Provider adapters and a strictly owner-authorized paid canary (8 PRs)

#### BR-090 — OpenAI Responses API frontier adapter

**Dependencies:** BR-083, BR-085, BR-089. **Priority:** P1.

**Implementation:** Harden existing OpenAI provider path; support Responses tool turns and validated GPT-6 Astra, GPT-6.1 Sol and GPT-6 Luna configurations, model-native effort, continuation and usage.

**Acceptance:** Conformance passes with mocked responses at $0; no unsupported effort, tool or cached-token field is silently accepted.

**Verification:** Official request/response contract snapshots, invalid/retry/limit/cancellation and tool-call continuation tests

#### BR-091 — Anthropic Claude API frontier adapter

**Dependencies:** BR-083, BR-085, BR-089. **Priority:** P1.

**Implementation:** Harden existing Anthropic Messages path for Opus/Sonnet/Fable/Haiku where available; correctly account for adaptive thinking, caching, tool calls and model-specific effort.

**Acceptance:** Conformance passes without a live paid request; unsupported thinking/tool combinations fail with actionable policy errors.

**Verification:** Mocked SDK fixtures, tool-result-turn, cache accounting, model retirement and transport failure tests

#### BR-092 — xAI Grok API frontier adapter

**Dependencies:** BR-083, BR-085, BR-089. **Priority:** P1.

**Implementation:** Harden existing xAI Responses path for current Grok models, configurable reasoning and server-side tool fees; handle alias migrations and usage distinctly.

**Acceptance:** All supported interactions pass offline conformance and no model alias price change silently bypasses a budget.

**Verification:** Grok protocol fixtures, reasoning/tool-fee metering, alias/deprecation, replay and provider outage tests

#### BR-093 — Google Gemini API frontier adapter

**Dependencies:** BR-083, BR-085, BR-089. **Priority:** P1.

**Implementation:** Add official Gemini API interaction/function tool protocol for Gemini 4 Argon and validated lower-cost Gemini models; map thinking levels, implicit cache, long-running background responses and quota signals.

**Acceptance:** Gemini fixture flows complete within the shared executor without requiring keys or paid inference; unsupported cross-provider parameter translation is rejected.

**Verification:** Function loop, thinking/caching, background resume, quota, retirement, unavailable-model tests

#### BR-094 — Frontier provider qualification and optional adapter onboarding

**Dependencies:** BR-090, BR-091, BR-092, BR-093. **Priority:** P2.

**Implementation:** Establish an evidence-based admissions process for additional providers (for example DeepSeek, Qwen, Kimi, Mistral or later entrants), requiring task evals, tool safety, policy and reliability rather than assumed marketing parity.

**Acceptance:** A new provider is plug-in compatible only after the same safety, cost, capability and quality conformance suite passes.

**Verification:** Provider contract harness with one intentionally failing candidate, opt-in pin/rollback and qualitative acceptance rubric

#### BR-095 — Cross-provider reasoning-effort controls and model policies

**Dependencies:** BR-085, BR-090, BR-091, BR-092, BR-093. **Priority:** P1.

**Implementation:** Expose exact provider/model/version and requested versus actual model-native effort; preserve model-specific levels such as high, xhigh, max and Gemini low/medium/high without treating them as equivalent across vendors.

**Acceptance:** Owner can select approved model/effort per team, role, task and agent; incompatible choices fail closed without silently downgrading.

**Verification:** Per-model configuration matrices, unsupported-effort tests, model fallback policy and immutable audit record

#### BR-096 — Owner-funded API connection onboarding and dry-run dashboard

**Dependencies:** BR-084, BR-087, BR-095. **Priority:** P1.

**Implementation:** Add owner-only provider enrollment and zero-charge diagnostics, expense forecast, estimated per-run ceiling, effective spend caps, enabled state and dry-run credentials presence checks.

**Acceptance:** No entered API key, new service or scheduled job spends money until explicit owner opt-in and nonzero cap, with rollback to $0 instantly available.

**Verification:** Unauthorized user/agent denial, cross-origin protection, UI no-store, no-spend fixture, rollback

#### BR-097 — First funded live API worker canary and provider invoice audit

**Dependencies:** BR-094, BR-096. **Priority:** P1.

**Implementation:** After explicit funding and keys, test one real bounded agent from each permitted provider on a low-risk task and reconcile documented paid usage with provider billing.

**Acceptance:** Observed model turns, cost, GitHub evidence, cancellation, quota and provider invoice reconcile; never claim live provider success from mocks.

**Verification:** Small scoped real-key canaries only after owner approval; invoice/ledger reconciliation and incident rollback

**Owner-only funding gate:** Explicit owner authorization to spend, provider keys and approved spending caps; no tests consume paid credits before that

### F11 — Queue- and event-driven cost-aware scaling with no per-dormant-agent work (13 PRs)

#### BR-098 — Provider quota governor and admission backpressure

**Dependencies:** BR-085, BR-087, BR-089. **Priority:** P1.

**Implementation:** Track requests/tokens per minute, concurrency, per-model quotas and provider reset signals; fair-share quotas with jittered backoff, circuit breakers and priority handling.

**Acceptance:** Rate-limited traffic queues without model spinning, thundering-herd retries or breach of owner money limits.

**Verification:** 429/5xx fault injection, quota-budget concurrency tests, fairness/starvation tests

#### BR-099 — Paid model request idempotency and uncertain outcome recovery

**Dependencies:** BR-087, BR-098. **Priority:** P1.

**Implementation:** Use unique request/turn correlation and vendor idempotency where supported; persist preflight intent and evidence; reconcile timeouts conservatively without replaying unknown paid requests.

**Acceptance:** An ambiguous provider response cannot create unbounded duplicate charges or double tool effects.

**Verification:** Crash matrix before/after every paid request, delayed reply, duplicate webhook and provider outage

#### BR-100 — Event-driven durable activation queue and orchestration

**Dependencies:** BR-089, BR-099. **Priority:** P1.

**Implementation:** Replace per-agent minute/hour polling with event-sourced ready-work jobs; durable queue, priority lanes, visibility timeouts, dead letters, idempotent enqueue and deduplicated schedules.

**Acceptance:** One million registered but dormant agents generate no recurring work/poll cost; only eligible approved tasks enter runnable queues.

**Verification:** Queue at-least-once replay, burst, race, paused-work and scheduled-no-op cost tests

#### BR-101 — Shardable leases and job ownership partitions

**Dependencies:** BR-020, BR-100. **Priority:** P1.

**Implementation:** Partition per-repository work ownership and logical agent metadata; support fencing generations, shard rebalancing and lease coordinator failover without a global lock.

**Acceptance:** Cross-shard contention never assigns two writers to one repository; failures recover only after stale execution authority is proven invalid.

**Verification:** Concurrent Postgres/failover race, partition movement, uniqueness and stale-generation tests

#### BR-102 — Autoscaled short-lived executor pools and image isolation

**Dependencies:** BR-100, BR-101. **Priority:** P1.

**Implementation:** Use bounded on-demand workers with per-provider/tenant pools, sandbox quotas, cold-start controls, budget-aware autoscaling and transport-independent queue consumers.

**Acceptance:** No idle million-process fleet; resource/concurrency allocations respond to real ready work and owner compute caps.

**Verification:** Autoscale cost baseline, pool isolation, cancellation, credential mounting and load-shedding tests

#### BR-103 — Database partitioning, indexes, retention and archival

**Dependencies:** BR-086, BR-101. **Priority:** P1.

**Implementation:** Separate transactional job state from append-only high-volume metrics; partition usage/events by time and tenant, implement pagination, rollups, encrypted storage and bounded retention.

**Acceptance:** Million-agent identity lookups and active-job writes meet measured indexed latency goals without full-table scans or unsafe data deletion.

**Verification:** EXPLAIN regression, partition prune, 10M-event synthetic data, replay/restore and retention integrity tests

#### BR-104 — Event-stream telemetry, high-cardinality aggregation and trace IDs

**Dependencies:** BR-086, BR-103. **Priority:** P1.

**Implementation:** Emit structured event stream of queue, provider, sandbox, CI and cost events with immutable correlation IDs; stream to rollup/analytics storage, not per-agent DB N+1 scans.

**Acceptance:** Fleet dashboards load from bounded aggregates while every sampled observation links to a verified event and no secrets leak.

**Verification:** Sampling/batch size, drop/backpressure, ordering, duplicate event, tenant isolation and cost tracking tests

#### BR-105 — Regional worker isolation, failover and operational recovery

**Dependencies:** BR-101, BR-102. **Priority:** P2.

**Implementation:** Plan regional capacity and residency; require region-specific keys, secrets, compliance policies, generation-fenced failover and restore points before multi-region writes.

**Acceptance:** An outage cannot create two authoritative writers or violate location rules; recovery points/objectives are measured, not promised.

**Verification:** Regional outage chaos test, failover drills, illegal cross-region route denial

#### BR-106 — Scheduler fairness, catch-up, preemption and load shedding

**Dependencies:** BR-098, BR-100. **Priority:** P1.

**Implementation:** Allocate work by importance, age, role, credits and available capacity; avoid duplicate overlapping jobs, support starvation prevention and bounded resume after outage.

**Acceptance:** Scheduler sustains busy/idle transitions without a 60-slot cron bottleneck or infinite retries and honors project priorities.

**Verification:** Simulated millions of logical schedules, fairness, outages, delayed token and event storms

#### BR-107 — Context caching, compaction and retrieval minimization

**Dependencies:** BR-088, BR-095. **Priority:** P2.

**Implementation:** Version durable context snapshots, invalidation, branch hashes, cache-aware prompts, content retrieval and iterative state compression without hiding critical safety requirements.

**Acceptance:** Repeated work reduces measured tokens and latency without degrading eval quality or reusing stale source or authority.

**Verification:** A/B token cost and task-success comparisons, stale-branch revocation, prompt-injection tests

#### BR-108 — Discounted asynchronous batch execution for eligible tasks

**Dependencies:** BR-094, BR-107. **Priority:** P2.

**Implementation:** Use vendor batch/flex modes only for noninteractive safe tasks with declared deadlines, verified cost advantage, provider consent and eventual reconciliation.

**Acceptance:** Batch does not block urgent PR work or exceed deadlines/budgets; provider batch differences are explicit.

**Verification:** Batch/online ordering, cancellation, retry, missed-deadline and charge reconciliation tests

#### BR-109 — All-in unit economics including infrastructure and tool costs

**Dependencies:** BR-087, BR-104. **Priority:** P1.

**Implementation:** Meter provider charges, GitHub Actions minutes, Render compute, Neon/database, blob storage, code-check cost, search/tool fees, and native credits only where measurable; tag project/team/work unit.

**Acceptance:** Owner sees financially meaningful total cost plus unknown/unallocated amounts, with monthly forecast and hard-money bounds.

**Verification:** Synthetic cloud invoices, cost-center allocation, unknown-source handling, outlier alerts and billing lag tests

#### BR-110 — Million-identity and 10,000-concurrent synthetic stress benchmark

**Dependencies:** BR-100, BR-101, BR-103, BR-104, BR-106. **Priority:** P2.

**Implementation:** Load-test 1,000,000 registered logical IDs, high-volume job queues and at least 10,000 concurrent simulated activations (not paid inference), measuring p50/p95/p99, database/storage costs and failure rates.

**Acceptance:** Published capacity/cost envelope and bottlenecks are measured under isolated synthetic load; never claim a million active paid agents from registry-only tests.

**Verification:** Repeatable distributed test with tenancy skew, burst/backpressure, failover, no double lease and cleanup

### F12 — Other business roles, evaluation, security, finance and end-to-end acceptance (8 PRs)

#### BR-111 — Generic role and tool-capability contract beyond developer agents

**Dependencies:** BR-088, BR-089. **Priority:** P1.

**Implementation:** Define versioned permissions and role packages for research, operations, support, sales, QA, bookkeeping and other business workflows while retaining development-specific GitHub controls.

**Acceptance:** An agent can be assigned a non-coding workflow without GitHub access by default, and no tool authority is inferred from role name or prompt.

**Verification:** Capability policy matrix, denied-tool tests, approval escalation and scope minimization

#### BR-112 — Multi-tenant organizations, workforce governance and approval policy

**Dependencies:** BR-084, BR-111. **Priority:** P1.

**Implementation:** Add company/team/manager/budget owner/RBAC policy scopes, human review on spending, payouts, sensitive records, security changes and consequential production actions.

**Acceptance:** Tenant isolation survives every API/analytics/tool path; all nonroutine authority checks use server policy and auditable human approval where required.

**Verification:** Cross-tenant authorization suite, approval replay and simulated high-risk business action tests

#### BR-113 — Difficulty-aware outcome evaluations and quality-adjusted productivity

**Dependencies:** BR-095, BR-111. **Priority:** P1.

**Implementation:** Build held-out job fixtures, error regression suites, accepted-task quality, review cost, rework and defect escape metrics; compare providers at matched difficulty and effort.

**Acceptance:** Optimization measures accepted useful outcomes per total cost and correction burden, not raw tokens or superficially merged PRs.

**Verification:** Stratified workload evaluation, evaluator reproducibility, blinded human adjudication and anti-gaming tests

#### BR-114 — Adaptive model router with bounded escalation and rollback

**Dependencies:** BR-113, BR-109. **Priority:** P1.

**Implementation:** Choose model/effort per task using validated eval confidence, dollar risk, context and historical quality; escalate after bounded failures and allow pinned owner overrides.

**Acceptance:** Automatic downgrades never violate task quality minima; every routing decision is explainable, cap-bounded and reversible.

**Verification:** Holdout policy evaluation, A/B paired tasks, budget-constrained routing, forced rollback and unsafe auto-escalation checks

#### BR-115 — Tenant security, prompt-injection and misuse defense at scale

**Dependencies:** BR-084, BR-088, BR-112. **Priority:** P0.

**Implementation:** Prohibit source/prompt-derived authority, secure all role tools, enforce data classes/retention, per-tenant network boundaries, provider data policies, abuse/rate controls and suspicious automation detection.

**Acceptance:** Hostile content cannot exfiltrate secrets, cross tenants, send unauthorized messages, alter ACLs or spend outside grants.

**Verification:** Threat model plus automated injection, tool escalation, webhook, sandbox, SSRF and exfiltration exercises

#### BR-116 — Fleet dashboards, forecasting, anomaly detection and owner controls

**Dependencies:** BR-104, BR-109, BR-112. **Priority:** P1.

**Implementation:** Scale observatory to tenant-filtered virtualized lists, fleet/account/model/role/project heatmaps, cost waterfalls, retry/idle breakdowns, efficiency scatterplots, Gantt traces and manual refresh/alert preferences.

**Acceptance:** Owner can drill from aggregated bill or progress chart to exact source evidence while rendering millions of rows without downloading them.

**Verification:** Synthetic high-cardinality data, accessibility, privacy, alert threshold, cost-forecast uncertainty and mobile UI tests

#### BR-117 — Invoice reconciliation, chargeback and per-business ledger exports

**Dependencies:** BR-086, BR-109, BR-112. **Priority:** P2.

**Implementation:** Reconcile per-provider invoices and platform fees, allocate team/business cost centers, support export/report auditing and unallocated/error buckets; explicitly isolate personal ChatGPT plan usage.

**Acceptance:** Monthly and daily finance reports balance to available authoritative statements or flag disagreement; no fabricated Work billing.

**Verification:** Partial statement, refund/credit, timezone billing window, duplicate webhook and accounting audit tests

#### BR-118 — End-to-end multi-provider, multi-role, scale and budget acceptance

**Dependencies:** BR-097, BR-110, BR-114, BR-115, BR-116, BR-117. **Priority:** P1.

**Implementation:** Run $0 synthetic load and separately owner-authorized tiny real paid canaries; verify mixed native/API fleet, enterprise role scopes, durable queues, billing controls, CI/PR outcomes and failover.

**Acceptance:** Boardroom can demonstrate stable mixed-provider production under measured provisioned resources and honest 1M-registered simulation; larger concurrent deployment requires separately funded capacity.

**Verification:** Documented synthetic+live evidence matrix, rollback, disasters, failed-provider routing, full financial reconciliation

## End-to-end acceptance must not be overstated

An approved plan is not a merged PR, a merged PR is not a deployed release, and a synthetic million-agent benchmark is not proof of financially viable million-agent operation. Every gate needs immutable evidence and explicit deployment status. Engine Room should count these additional registered planned work units only after this version-3 registry change is merged.
