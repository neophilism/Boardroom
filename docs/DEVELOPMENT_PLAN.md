# Boardroom — Complete Implementation Roadmap

**118 planned, approved-for-planning PR work units (roadmap version 3)**. These are *planned PRs*, not currently implemented or verified pull requests. BR-001 creates this plan; subsequent PRs require actual code, reviews, tests, and merges.

**Portfolio priority:** Boardroom is the highest-priority project until an end-to-end unattended scheduled-agent loop with an Owner Action Board is working. Do not fabricate overall portfolio ranking changes in the currently undeployed Boardroom app; the owner can later change the rank using its priority editor.

**Core rule:** One authorized active development session per GitHub repository. Each recurring ChatGPT scheduled task can use exactly the same prompt; arrivals are anonymous to one another at the prompt layer and receive unique server-generated session IDs. Provider-account/schedule metadata is optional and is never used as a false account-wide concurrency lock. Repository claims are atomic and privileged writes are fenced.

**Selection:** Pick the first available repository in the owner's ordered priority list. If none is eligible, select the eligible nonpriority repository with the oldest independently verified development update. If none is eligible, make a bounded source-backed Coffee pass, recheck once when new evidence is available, and finish idle truthfully. Inside an assigned repo, first resume incomplete approved work before choosing the next eligible unit.

**End of session:** Push/checkpoint actual work, report verified outcome, make one bounded evidence-based Coffee Corner answer pass, release repository assignment, and terminate. If a technical question would otherwise block progress, search/ask Coffee Corner; if only the owner can act, post a specific request on the private Owner Action Board. Never request secrets in chat or a public GitHub issue.

**External scheduling feasibility:** A ChatGPT scheduled task can be a trigger only to the extent its configured Work/plugins/tools actually allow the required authenticated Boardroom action and code work. BR-004 is an explicit real-world gate; BR-005 implements a supported hosted-worker fallback rather than assuming undocumented capabilities. No perpetual worker process is assumed within a scheduled ChatGPT task.

**Repository contract:** `registry/prs.json` is the sole authoritative approved PR plan, using the shared contract in `registry/PR_FORMAT.md`. `registry/roadmap.json` is retired. GitHub's live API owns actual PR/merge state; an empty `pullRequests` array means the PR is planned but not yet linked. Historical approved work-unit IDs are immutable.

**Owner Action Board:** One private place for all manual requests (account creation, scoped token or secret, API key provisioning, payment, approval, owner sign-in, etc.). Agents specify the action, precise permissions, target location, costs, affected repos, blockers, and verification method. Similar requests aggregate into one action. Secret values travel through scoped secret stores/entry flows, never Coffee Corner, public GitHub, or logs.

**Execution priority:** First prove live scheduled arrivals; then claim/exclusivity and Owner Action Board; then end-to-end PR development and durable recovery; then Coffee collaboration and consolidated oversight; then provider adapters and larger-scale hardening. All PRs must satisfy their acceptance criteria, not just compile.

**Cross-repository follow-up:** BR-067 will require an appropriately tracked *separate PR in Engine Room* for its UI consumer. Do not count an Engine Room PR as a Boardroom PR, and do not duplicate roadmap denominators.

**Security note:** The current GitHub repository is public. Its planning documents may be public, but runtime operational data and owner requests must be private and authenticated. Do not commit credentials, personal data, or owner action request contents here.

---

## F1: Bootstrap and scheduled-task feasibility (8 PRs; P0)

### BR-001 — Canonical project roadmap and agent instructions

**Scope:** Commit approved machine-readable plan, architecture, repository instructions, and stable work-unit naming.

**Acceptance:** Roadmap is valid, counted from actual milestones, and readable by existing Engine Room importers.

**Dependencies:** None

### BR-002 — TypeScript application skeleton and CI

**Scope:** Initialize Next.js API/UI, shared typed package, formatting, lint, tests, and GitHub Actions.

**Acceptance:** Fresh checkout builds and tests; deliberate failing check blocks merging.

**Dependencies:** BR-001

### BR-003 — Minimal authenticated arrival endpoint

**Scope:** Expose a private minimal check-in endpoint and idempotent arrival acknowledgment for temporary sessions.

**Acceptance:** Authenticated request creates a traceable arrival; unauthenticated and replayed requests are rejected or deduplicated.

**Dependencies:** BR-002

### BR-004 — Live ChatGPT scheduled-execution feasibility gate

**Scope:** Demonstrate one real scheduled ChatGPT task invoking the Boardroom integration, receiving an assignment, and reporting a result; record connector limits.

**Acceptance:** Evidence from a real scheduled run documents what works and any approval pauses; no synthetic run passes this gate.

**Dependencies:** BR-003

### BR-005 — Supported provider connector or external-runner fallback

**Scope:** Implement a custom supported tool/app interface if available; otherwise a clearly labeled hosted-worker activation path with identical agent instructions.

**Acceptance:** At least one supported unattended execution route invokes the API and is demonstrably usable; unsupported routes remain disabled.

**Dependencies:** BR-004

### BR-006 — Neon schema, migrations, and transaction outbox

**Scope:** Create migrations and domain types for repositories, sessions, leases, work units, owner requests, discussions, checkpoints, and outbox.

**Acceptance:** Clean and incremental migration tests pass; transaction rollback leaves no orphan assignments.

**Dependencies:** BR-002

### BR-007 — Owner authentication and restricted administration

**Scope:** Protect owner endpoints and private application, add roles and strong session controls, audit security changes.

**Acceptance:** Anonymous and agent credentials cannot access owner data or modify administrative controls.

**Dependencies:** BR-006

### BR-008 — Scoped GitHub App onboarding

**Scope:** Implement GitHub App installation/read permissions, repository access discovery, webhook verification foundation, and credential rotation.

**Acceptance:** Can securely enumerate allowed repositories and fetch authoritative metadata without embedding a personal token.

**Dependencies:** BR-006

## F2: Stateless arrival, repository queue, and exclusivity (12 PRs; P0)

### BR-009 — Repository inventory and rename-safe identity

**Scope:** Import registered repositories using immutable numeric GitHub IDs; track archived, disabled, and restricted repositories.

**Acceptance:** A repo rename preserves its identity, history, priority, and prior assignments.

**Dependencies:** BR-008

### BR-010 — Canonical roadmap/PR-registry adapter

**Scope:** Read the shared registry/prs.json contract with strict validation and conflict diagnostics; reject competing formats.

**Acceptance:** Conflicting or invalid sources fail visibly; historical plan counts and work-unit IDs are preserved.

**Dependencies:** BR-009

### BR-011 — Verified work-unit and dependency eligibility

**Scope:** Calculate which approved PR units are actionable, merged, blocked, or await prerequisite work.

**Acceptance:** No new tasks are fabricated and already completed work is never silently reassigned.

**Dependencies:** BR-010

### BR-012 — Ordered owner priority repositories list

**Scope:** Create private edit/reorder APIs for the owner-maintained priority list.

**Acceptance:** First available top-ranked priority repository wins over every ordinary repository.

**Dependencies:** BR-007, BR-009

### BR-013 — Authoritative least-recently-updated comparator

**Scope:** Derive latest genuine development event from GitHub, with creation-date fallback and deterministic tie-breaks.

**Acceptance:** Oldest eligible nonpriority repo is chosen; local refresh timestamps do not affect ordering.

**Dependencies:** BR-009

### BR-014 — Stateless identical-prompt session admission

**Scope:** Generate a new unique run ID for every scheduled arrival; do not require customized per-task instructions or retained agent memory.

**Acceptance:** Two identical prompts from different accounts can safely start independent sessions.

**Dependencies:** BR-003, BR-006

### BR-015 — Optional activation-source metadata and replay protection

**Scope:** Record provider and nonsecret source/schedule identifiers when available; permit unidentifiable-but-authenticated ephemeral runs.

**Acceptance:** No false account-wide singleton; duplicate delivery is idempotent where verified invocation identity exists.

**Dependencies:** BR-014

### BR-016 — Atomic exclusive repository assignment

**Scope:** Claim an eligible repository transactionally with a unique owner, generation counter, and race-safe row locking.

**Acceptance:** Hundreds of simultaneous claims yield at most one active owner for each repository.

**Dependencies:** BR-011, BR-012, BR-013, BR-014

### BR-017 — Leases, heartbeats, and session renewal

**Scope:** Define server-clock lease expiry, bounded heartbeat intervals, and renewal authorization.

**Acceptance:** Expired or unknown sessions cannot renew; healthy sessions retain their assignment.

**Dependencies:** BR-016

### BR-018 — Session states, outcomes, and idempotent release

**Scope:** Implement RUNNING, YIELDED, COMPLETED, BLOCKED, RECOVERING, FAILED, and UNKNOWN transitions with audit history.

**Acceptance:** Duplicate completion is harmless; release never frees a newer session's lease.

**Dependencies:** BR-017

### BR-019 — Repository selection conformance suite

**Scope:** Test strict priority-first selection, oldest-update fallback, simultaneous claims, ties, and idling.

**Acceptance:** Deterministic cases and high-contention integration tests all pass.

**Dependencies:** BR-016, BR-018

### BR-020 — Blocked repository and recovery-eligibility policies

**Scope:** Prevent repeated selection of unrecoverable work while preserving automatic retries after blockers clear.

**Acceptance:** Blocked repositories leave the eligible pool with auditable reasons and become eligible after verification.

**Dependencies:** BR-011, BR-018

## F3: Owner Action Board — private human escalation (10 PRs; P0)

### BR-021 — Owner action relational model and states

**Scope:** Create durable owner actions with repository/work unit, blockers, required human authority, severity, costs, and lifecycle.

**Acceptance:** Every request has a unique ID, creator session, immutable audit history, and status transitions.

**Dependencies:** BR-006, BR-007

### BR-022 — Agent escalation and owner-only classifier

**Scope:** Define which unmet conditions require an owner rather than Coffee Corner or autonomous troubleshooting.

**Acceptance:** Agent cannot ask owner for a task another authorized agent can perform; genuinely human-only blockers are posted.

**Dependencies:** BR-021

### BR-023 — Action templates for accounts, credentials, purchases, and approvals

**Scope:** Provide structured actionable requests with exact target systems, minimum permissions, prerequisites, expected expense, and verification.

**Acceptance:** An example GitHub token/account/purchase request is specific, concise, and secret-free.

**Dependencies:** BR-022

### BR-024 — Duplicate merging and blocker aggregation

**Scope:** Deduplicate requests for the same missing key, provider account, approval, or configuration prerequisite across repositories.

**Acceptance:** Multiple agents needing one prerequisite generate one owner card with all affected projects listed.

**Dependencies:** BR-021, BR-023

### BR-025 — Private Owner Action Board inbox

**Scope:** Implement a single owner dashboard for outstanding, blocked, awaiting verification, complete, and declined actions.

**Acceptance:** Owner can sort, filter, inspect, and change action state without opening individual chat windows.

**Dependencies:** BR-024

### BR-026 — Owner action detail and evidence view

**Scope:** Display step-by-step instructions, exact requested secret name or scope, affected repositories, links, urgency, and reason.

**Acceptance:** A user can carry out an action without asking which permission or destination is required.

**Dependencies:** BR-025

### BR-027 — Secure credentials and external-account handoff

**Scope:** Use secret-store references or scoped platform secret-entry flows, with presence/capability verification; never put values in chat, logs, DB plaintext, or public GitHub.

**Acceptance:** Secret values never appear in Boardroom messages; agents receive only scoped capabilities and verification outcome.

**Dependencies:** BR-023, BR-025

### BR-028 — Owner approval boundaries and purchase controls

**Scope:** Implement explicit approvals for spending, destructive actions, privilege changes, legal/political risks, and production release gates.

**Acceptance:** Unapproved risky actions cannot be executed even when a scheduled run attempts them.

**Dependencies:** BR-021, BR-007

### BR-029 — Resolution, verify-and-requeue, and decline handling

**Scope:** When an owner completes an action, validate fulfillment and automatically re-enable affected work; support clarification and rejection.

**Acceptance:** A verified completed secret/account task unblocks all dependent repositories without manual prompts to agents.

**Dependencies:** BR-024, BR-027

### BR-030 — Action notifications, batching, and safe audit trail

**Scope:** Generate consolidated owner summaries, age-based reminders, redaction, and one-click action references.

**Acceptance:** No repetitive duplicate alerts and no personally sensitive material in emailed notification bodies.

**Dependencies:** BR-025, BR-029

## F4: GitHub work execution and autonomous PR chaining (13 PRs; P0)

### BR-031 — Repository context assembler

**Scope:** Load AGENTS.md, canonical approved units, historical decisions, dependency status, current branches, and checkpoints.

**Acceptance:** Any new model run can understand and resume a repo without chat memory.

**Dependencies:** BR-010, BR-016

### BR-032 — Provider-neutral tool protocol and typed SDK

**Scope:** Expose standard claim, context, checkpoint, question, owner-action, and completion tools via versioned API/MCP or equivalent.

**Acceptance:** Provider SDKs pass schema, authorization, and negative conformance tests.

**Dependencies:** BR-005, BR-018

### BR-033 — Isolated coding execution harness

**Scope:** Provide a short-lived sandbox/worktree or supported hosted worker with bounded compute and revocable access.

**Acceptance:** A live worker checks out its assigned repo, executes tests, and is terminated on cancellation.

**Dependencies:** BR-032

### BR-034 — Fenced GitHub write gateway

**Scope:** Route privileged writes through an authorizer validating repo, run, permission, current generation, and expected refs.

**Acceptance:** Old, unauthorized, or cross-repository sessions cannot push or merge through Boardroom.

**Dependencies:** BR-017, BR-033, BR-008

### BR-035 — Safe branch management and write idempotency

**Scope:** Create/reuse deterministic per-unit branches, avoid duplicate commits, check SHA preconditions, and handle conflicts.

**Acceptance:** Retried operations do not duplicate branches or overwrite concurrently updated refs.

**Dependencies:** BR-034

### BR-036 — Work-unit-linked PR creation and updates

**Scope:** Create PRs titled with stable Boardroom roadmap IDs; update existing PRs rather than generating duplicates.

**Acceptance:** Exact ID matching links real GitHub PRs to approved units and preserves canonical denominator.

**Dependencies:** BR-035

### BR-037 — CI, test, and acceptance-evidence collector

**Scope:** Ingest authoritative check suites, test status, unit acceptance, and timestamps with provenance.

**Acceptance:** Failing tests prohibit a false completion or automatic merge.

**Dependencies:** BR-036

### BR-038 — Review and safe merge policy engine

**Scope:** Enforce protected-branch checks, required reviews, compatibility conditions, and owner-only exceptions.

**Acceptance:** Only correctly authorized green PRs can merge; bypass attempts are denied and logged.

**Dependencies:** BR-037, BR-028

### BR-039 — Continuous eligible PR-chain workflow

**Scope:** Continue approved eligible work within the same activation, preferring the current repository and using checkpointed fenced handoffs when work must wait or the repository is exhausted.

**Acceptance:** One activation may complete successive PR units and, after checkpoint and fenced release, move to another repository while holding at most one lease at a time.

**Dependencies:** BR-011, BR-038

### BR-040 — Durable Git checkpoints and handoff manifest

**Scope:** Persist branch/head SHA, tests, remaining work, retry info, links, and code pushed remotely.

**Acceptance:** Another independent session can find every unfinished change and its next action.

**Dependencies:** BR-035, BR-018

### BR-041 — Cross-session resume and interruption handling

**Scope:** Detect existing draft work, resume by approved work-unit ID, and yield safely at execution limits.

**Acceptance:** A new scheduled ChatGPT/provider run resumes real incomplete code without the original chat.

**Dependencies:** BR-040, BR-039

### BR-042 — Real scheduled-task-to-GitHub end-to-end trial

**Scope:** Demonstrate scheduled arrival, claim, working code change, test, mapped PR, checkpoint, and release in an authorized test repo.

**Acceptance:** End-to-end evidence includes real run, assignment, PR, CI, and finish timestamps; synthetic demo is insufficient.

**Dependencies:** BR-004, BR-034, BR-036, BR-041

### BR-043 — Cross-repository compatibility dependency planner

**Scope:** Record producer/consumer contracts and versioned migrations; gate incompatible cross-project changes.

**Acceptance:** A breaking shared API migration blocks incompatible merges until an approved transition is verified.

**Dependencies:** BR-011, BR-038

## F5: Coffee Corner and agent collaboration (8 PRs; P0)

### BR-044 — Threaded engineering collaboration schema

**Scope:** Store scoped project threads, questions, messages, status, linked PRs and responsible work units.

**Acceptance:** Messages remain searchable and associated with verifiable engineering subjects.

**Dependencies:** BR-006, BR-007

### BR-045 — Search-before-asking knowledge retrieval

**Scope:** Search existing threads, repository ADRs, and relevant code/doc references before posting a duplicate question.

**Acceptance:** Agent receives relevant prior resolutions without relying on previous chat memory.

**Dependencies:** BR-044, BR-031

### BR-046 — Project-scoped question workflow

**Scope:** Permit an agent to post a concrete question with blocker classification, evidence, and optional deadline.

**Acceptance:** Questions are readable in English and never require other agents to stop ongoing work.

**Dependencies:** BR-044, BR-022

### BR-047 — Evidence-based peer-answer workflow

**Scope:** Allow agents to answer questions only within documented relevant work knowledge, with links and uncertainty disclosure.

**Acceptance:** Unsupported claims are distinguishable from source-backed engineering answers.

**Dependencies:** BR-046

### BR-048 — Asynchronous help and automatic unblock

**Scope:** Track answered questions, integrate accepted answers into blocked work eligibility, and notify next eligible session.

**Acceptance:** A useful answer makes the work resumable without a human chat intervention.

**Dependencies:** BR-047, BR-020

### BR-049 — Architecture deliberation and repository ADR persistence

**Scope:** Document meaningful technical decisions in GitHub ADRs, not chat alone; respect owner approval boundaries.

**Acceptance:** Every accepted architectural change has a durable repository reference and compatibility checks.

**Dependencies:** BR-047, BR-034

### BR-050 — End-of-session Coffee Corner service step

**Scope:** After finishing real work and checkpointing, answer bounded unanswered qualified questions before departure.

**Acceptance:** Completed session makes a best-effort peer-help pass without extending forever or leaking the lease.

**Dependencies:** BR-047, BR-040, BR-018

### BR-051 — Discussion privacy, moderation, and prompt-injection controls

**Scope:** Apply project-scope access, personal-data and secret scanning, retention policy, rate limiting, and distrust of instructions in messages.

**Acceptance:** Sensitive fixtures are blocked/redacted; chat messages cannot elevate agents' privileges.

**Dependencies:** BR-046, BR-007

## F6: Automatic recovery, event reconciliation, and reliability (9 PRs; P0)

### BR-052 — Deterministic watchdog and stalled-session detection

**Scope:** Monitor runner health, heartbeat age, idling, stuck approvals, and sessions over budget.

**Acceptance:** Health classification never claims RUNNING from a stale heartbeat alone.

**Dependencies:** BR-017, BR-018

### BR-053 — Verified process cancellation and recovery hold

**Scope:** Terminate or isolate old execution before writable reassignment; provide recovery hold for unknown termination.

**Acceptance:** No second authorized writable process starts while the original can still write.

**Dependencies:** BR-052, BR-034

### BR-054 — Stale-session fencing and takeover race tests

**Scope:** Prove lease generations are checked at every privileged write and cancellation race.

**Acceptance:** A late original worker is rejected after safe takeover even under injected latency.

**Dependencies:** BR-053

### BR-055 — Transactional outbox dispatcher and operation ledger

**Scope:** Persist intended dispatch and GitHub side effects before execution, with idempotency keys and crash replay.

**Acceptance:** Crash between DB commit and queue submission loses no assignment; retry causes no duplicate write.

**Dependencies:** BR-006, BR-033, BR-035

### BR-056 — Retry policies, backoff, and dead-letter handling

**Scope:** Classify transient provider/API failures versus permanent blockers with bounded retry budgets.

**Acceptance:** Rate limits cause jittered retries; persistent errors create visible incidents and do not loop forever.

**Dependencies:** BR-055, BR-020

### BR-057 — GitHub webhook ingestion with signatures and deduplication

**Scope:** Ingest authenticated PR, push, repository, and workflow events with delivery IDs.

**Acceptance:** Duplicate/out-of-order deliveries cannot regress verified project state.

**Dependencies:** BR-008, BR-037

### BR-058 — Periodic authoritative GitHub reconciliation

**Scope:** Reconcile missed webhooks and source freshness while respecting rate limits and conditional requests.

**Acceptance:** Real GitHub state repairs missing webhook updates without snapshot freshness being misrepresented.

**Dependencies:** BR-057, BR-010

### BR-059 — Operational metrics, diagnostics, and alert routing

**Scope:** Expose queue latency, throughput, stale leases, error rate, retry frequency, budget usage, and source freshness.

**Acceptance:** Failures have actionable root-cause and evidence links; owner is not spammed by repeated symptoms.

**Dependencies:** BR-052, BR-058

### BR-060 — Concurrency and chaos acceptance test suite

**Scope:** Simulate simultaneous arrivals, process death, missed heartbeats, provider outages, webhook replay, and restarts.

**Acceptance:** Exclusive assignment, safe recovery, and durable progress pass repeatable fault injection.

**Dependencies:** BR-019, BR-054, BR-055, BR-058

## F7: Owner dashboard and Engine Room integration (8 PRs; P1)

### BR-061 — Private Boardroom UI shell and navigation

**Scope:** Build responsive authenticated navigation for Work Board, Coffee Corner, Owner Actions, Operations, and audit.

**Acceptance:** All private views deny unauthorized access and work on desktop/mobile.

**Dependencies:** BR-007

### BR-062 — Live repository Work Board and priority editor

**Scope:** Show repository availability, current assignment, work ID, last actual update, and editable priority order.

**Acceptance:** Refresh accurately reflects live leases and priority changes without stale status confusion.

**Dependencies:** BR-012, BR-013, BR-018, BR-061

### BR-063 — Unified Owner Action Board UX

**Scope:** Provide action templates, affected-project grouping, secure instructions, verify/reopen, and owner approval interface.

**Acceptance:** Owner can find and complete all pending manual requests in one private view.

**Dependencies:** BR-025, BR-026, BR-028, BR-029, BR-061

### BR-064 — Coffee Corner UX and discussion search

**Scope:** Build threaded work-only discussion interface with source references and question state.

**Acceptance:** Owner can observe and search all authorized engineering discussions; agents can participate through API.

**Dependencies:** BR-045, BR-051, BR-061

### BR-065 — Agent sessions, recovery, and event timeline

**Scope:** Display ephemeral runs, originating provider when known, checkpoints, Git events, time spent, error provenance, and audit.

**Acceptance:** Reports distinguish scheduled activation from actual code work and verified completion.

**Dependencies:** BR-052, BR-059, BR-061

### BR-066 — Owner operational controls and priority overrides

**Scope:** Add safe pause/resume, cancel, priority reorder, budget change, disable provider, and hold/recover actions.

**Acceptance:** Owner changes are RBAC-checked, auditable, and cannot accidentally release an active fenced worker.

**Dependencies:** BR-062, BR-065, BR-028

### BR-067 — Engine Room read-only operational integration

**Scope:** Publish versioned health/assignment API and add compatible Engine Room presentation without writing PR progress manually.

**Acceptance:** Engine Room shows Boardroom execution data separately from GitHub-derived roadmap progress.

**Dependencies:** BR-059, BR-065

### BR-068 — Overnight summary and consolidated digests

**Scope:** Summarize verified PRs, commits, tests, deployments, blocking Owner Actions, failures, and next priorities.

**Acceptance:** Single digest links to evidence and does not confuse model claims with observed GitHub facts.

**Dependencies:** BR-030, BR-058, BR-065

## F8: Provider expansion, hardening, and production acceptance (10 PRs; P1)

### BR-069 — Multi-account ChatGPT scheduled-task onboarding

**Scope:** Document one identical task prompt and provider connection steps; verify 5-account/50-task-style arrivals without requiring numbered instructions.

**Acceptance:** Independent overlapping scheduled arrivals cooperate under repository leases and owner can audit real sessions.

**Dependencies:** BR-004, BR-042, BR-060

### BR-070 — Claude scheduled-agent adapter

**Scope:** Implement supported Claude-origin activation and tool interoperability without privileged shortcuts.

**Acceptance:** Claude sessions pass the same claim, code, checkpoint, and end tests as the primary adapter.

**Dependencies:** BR-032, BR-060

### BR-071 — Grok scheduled-agent adapter

**Scope:** Implement supported Grok-origin activation and tool interoperability without privileged shortcuts.

**Acceptance:** Grok sessions pass the same claim, code, checkpoint, and end tests as the primary adapter.

**Dependencies:** BR-032, BR-060

### BR-072 — Provider conformance and capability registry

**Scope:** Publish provider capability checks, error contracts, version negotiation, execution limits, and unsupported-path behavior.

**Acceptance:** New provider adapters cannot register as writable until all mandatory conformance tests pass.

**Dependencies:** BR-069, BR-070, BR-071

### BR-073 — Large-scale scheduling and concurrency benchmark

**Scope:** Load test 500+ registered activation sources, hundreds of arrival requests, and contention across many repositories.

**Acceptance:** No artificial ten-agent limit, no double claims, measured latency/error/cost under documented capacity.

**Dependencies:** BR-060, BR-072

### BR-074 — Per-session and aggregate usage/budget guardrails

**Scope:** Track tokens, model charges, platform compute, quotas, and owner-configured thresholds.

**Acceptance:** Over-budget jobs safely checkpoint/yield; charges are visible and never silently increased.

**Dependencies:** BR-033, BR-066

### BR-075 — Security hardening, privacy review, and threat tests

**Scope:** Harden RLS, webhooks, credentials, write gateway, audit retention, abuse controls, and owner-action redaction.

**Acceptance:** Cross-tenant/provider, prompt-injection, secret-exposure, and privilege-escalation tests fail closed.

**Dependencies:** BR-027, BR-034, BR-051, BR-060

### BR-076 — Backup, point-in-time restore, and disaster recovery

**Scope:** Implement verified backup/restore of Neon coordination state and retention of GitHub handoff references.

**Acceptance:** Fresh recovery environment restores assignments as safely unowned/reconciling, never blindly active.

**Dependencies:** BR-055, BR-075

### BR-077 — Production deployments and service-capacity runbook

**Scope:** Document Render/Neon topology, webhook URLs, zero-downtime migration, resource capacity, incident rollback, and onboarding.

**Acceptance:** Reproducible staging-to-production deployment with health and rollback evidence.

**Dependencies:** BR-060, BR-076

### BR-078 — Final unattended multi-agent acceptance and audit

**Scope:** Demonstrate production-like real scheduled workers, priority selection, one-per-repo, PR chaining, Coffee, owner escalation, crash recovery, and reports.

**Acceptance:** Evidence-linked acceptance matrix passes; no claim of production completion until verified on live integrations.

**Dependencies:** BR-043, BR-050, BR-060, BR-063, BR-067, BR-069, BR-074, BR-075, BR-077

## Release gates

- **Gate A — Feasibility (BR-004/005):** A real scheduled ChatGPT run can reach the supported tool/connector or an explicit fallback is demonstrated. No false claims of native arbitrary API access.
- **Gate B — Exclusive dispatch (through BR-020):** Concurrent attempts cannot double-assign a repository, and priority-first/oldest-second selection is tested.
- **Gate C — Owner blockers (through BR-030):** Owner can resolve one real missing credential or account setup request privately, with verification and automatic requeue.
- **Gate D — Development loop (through BR-042):** One real scheduled activation changes code, creates a mapped PR, verifies results, and checkpoints.
- **Gate E — Collaboration and safety (through BR-060):** Coffee question answered and meaningful crash injected with successful fenced recovery.
- **Gate F — Production (BR-078):** 50-style activation-source onboarding, provider-agnostic conformance, owner dashboard, audit, and resilience proven. Do not claim completion before production acceptance.

## Approved additions — stable scheduled-agent names (Version 2)

### BR-079 — Owner-approved agent roster

Maintain all 601 owner-supplied names exactly, including punctuation and case, in `docs/AGENT_NAMES.md` and `registry/agent-names.json`. This roster is an explicit **display-name allowlist**, not an authentication mechanism. Test exact text and uniqueness. (Depends on BR-001.)

### BR-080 — Server-verified named identity

Each scheduled task receives one owner-assigned name from the roster and retains it on every hourly activation; its run ID remains new every time. Bind the name to a unique secret credential or trusted provider authentication and derive it server-side. Do not accept name claims as proof of identity. Reject unregistered names at onboarding/admission and return the verified display name with session details. No raw bearer token or personal details may be committed to GitHub. (Depends on BR-079 and BR-003.)

## F9–F12: API-agent expansion and million-identity capacity (BR-081 through BR-118)

The owner-requested API integration and long-term mixed-role scaling roadmap is canonical in `registry/prs.json` and specified in detail in [API_AGENT_SCALE_PLAN.md](API_AGENT_SCALE_PLAN.md). It adds 38 work units without changing the existing BR-001–BR-080 identities, dependencies, PR mappings or acceptance evidence. The new provider adapters and scale tests are *planned*, not deployed or proven. The entire paid fleet remains $0-disabled until owner-provided credentials and explicit funding authorization. No statement here certifies million-agent production capacity.


## Operational follow-up — BR-020/BR-004 stalled scheduled-agent claims (October 18, 2026)

Gort, Joi and Bishop provided real scheduled-run evidence of stale local roadmap states after GitHub PRs #106 and #105 merged. PR #116 repaired the current-assignment advancement boundary. The complementary maintenance repair tracks queued work honestly and prevents a new repository lease based on old local merge evidence.

- On an admitted claim, preflight the selected eligible repository's last successful GitHub reconciliation outside the database transaction. Refresh a stale repository directly and rerun eligibility, with a fixed four-repository bound.
- Before granting a lease, check freshness again inside the lease transaction. Never allow an unknown/stale GitHub view to turn into an authorized claim.
- Coalesce duplicate inventory and webhook queue rows, preserve a SUPERSEDED record and audit it, keep inventory progress incremental, and let one of every three dispatch slots prefer inventory to avoid starvation.
- GitHub's ten-minute scheduled Action is best-effort. A main-branch push now also runs a bounded maintenance tick. Event-driven direct repository operations and on-demand claim reconciliation do not depend on punctual cron delivery.
- Perform real PostgreSQL concurrency, idempotency, ledger/migration hash, and queue-fairness tests. Do not claim full autonomous development until a live agent can claim fresh work, make a gated write, produce an evidence-linked PR and safely finish.
- Deployment is independently verified using exact revision and service readiness evidence. Do not infer production rollout from a merged PR alone. Keep native ChatGPT app safety rejections separate from coordinator reconciliation failures.


### Follow-up to October 18 maintenance recovery: partial import failures

Live Neon review after PR #124 confirmed that the Boardroom work units had become MERGED with the correct PR numbers and duplicate inventory work was superseded, but two other repositories returned source-verification errors. A failed repository must remain ERROR and unapproved; however, it must not force all later inventory pages to retry indefinitely. The importer now persists partial-page audit evidence and completes the current page while preserving the numeric continuation cursor; next sweeps revisit the failed repositories. Tests assert that a partial failure produces the next-page cursor, and invalid importer reports still fail closed. Independently review and repair the affected repositories' source registries before calling them eligible.



## October 18 operational repair — BR-017/018/036/039/040/041

The owner authorizes 50-minute useful work sessions across approved projects. This
repair retains the canonical registry IDs and counts; it does not claim full
work-unit acceptance or native 50-minute execution before live observation.

- Reuse existing approved mapped PR branches consistently for source snapshots,
  edits, readiness and merge. Verify numeric repository identity, approved numeric
  PR links and live head/base metadata; reject forks, unrelated PRs, protected/default
  branch writes and ambiguous multiple open branches. No client-selected repository
  or arbitrary branch can grant authority.
- Publish one identical 50-minute instruction from the server profile, launch
  page and protocol. Checkpoint and continue another independent unit or project
  while CI runs. Preserve the original clock, all prerequisites and green-check gates.
- Raise the old default 30-minute limit to 55 minutes with an additive fingerprinted
  migration. Preserve custom limits, token/tool caps and monetary budgets.
- Make handoff generations unique within each run across repositories, require
  a checkpoint for the current unit, and safely reconcile lost handoff responses.
  Prefer independent same-project work, then use the normal portfolio selection.
- Support older installed connections through the existing advance signature.
  Verify source/mapping adversarial cases and PostgreSQL handoff races, stale
  authority rejection, pending-CI resume, migrated limits and clock continuity.
- Merge only after current-head checks; deploy the existing service and verify
  its exact revision, readiness, served instructions and authenticated tool contract.
  Native scheduled duration remains separately observable, never inferred from code.

## Admission, evidence and continuation reliability

The follow-up repair preserves existing work-unit IDs and acceptance boundaries.
An overlapping activation must distinguish a live session from an expired or
held lease. A named OAuth arrival can run one bounded, credential-scoped recovery
pass under the normal admission locks; in-flight writes and unresolved GitHub
effects remain held. Recovery is no longer dependent on a timely maintenance
schedule alone.

Source-owned `contributingPrs` and `priorEvidencePrs` authorize historical evidence
reads without granting branch-write or merge authority, and cannot establish full
unit acceptance. The compatible continuation endpoint handles typed evidence and
plan blockers through the separately fenced handoff path. A premature finish
requires an actual stop condition, with external limits recorded as agent reports.

The GitHub gateway must durably record intent before outbound mutation, preserve
uncertain outcomes across transaction rollback, and reconcile positive remote
evidence before releasing the affected assignment. User cancellation stops work
without discarding an unresolved remote effect. Verification covers concurrent
arrivals, stale generations, ledger persistence, guarded release, historical PR
reads and continuation behavior; live scheduled execution remains a separate gate.

### Shared instruction rollout — recovery and continuous work

Combine the owner-supplied recovery rules with BR-039's 50-minute work loop in
`src/domain/scheduled-instruction.ts` and the matching protocol. Preserve named
connection routing, schema discovery, precise evidence-based failure reporting,
no permission-denial workarounds, recurring-schedule preservation and best-effort
release after checkpoint failure. Keep pending CI as a same-run task handoff.

Update existing scheduled tasks on each account through that account's authorized
automation tools. Preserve identities, connections, task IDs and schedules; read
back every prompt and enabled state. This account cannot claim updates on another
account. Provide the other account a concrete rollout request referencing the
versioned shared protocol. No recurring task, provider spending or credential
permission is added by this rollout.

Live follow-up found that native finish accepted one-minute exits while eligible
work remained, and the advertised hosted-runner 100-call cap was being treated
as native connector usage evidence. Route native completion through a
50-minute continuation decision: checkpoint and release only the old lease,
return CONTINUE_REQUIRED without acquiring a replacement lease, and require
the agent to acknowledge by claiming the same run. Distinguish agent-reported
activation-wide hard-stop evidence from server-verified platform facts. Allow
truthful empty-queue, lost-authority, owner-pause and actual deadline stops;
retain best-effort release when checkpointing fails. Do not raise hosted model,
token, tool or monetary caps. Test native MCP dispatch, stale-generation replay,
idle bypass, early stop and cross-project continuation in real PostgreSQL.

The follow-up also rejects partial-draft churn: native advance/yield requires a
verified merge, a concrete prerequisite/blocker, or implementation-complete work
with immutable acceptance evidence and a matching current PR head whose CI is
actually pending. Unfinished draft integration and failed CI stay on the current
unit. Record external observations as agent-reported, preserve unresolved GitHub
release holds, and reconcile ADMITTED-after-release claims without demanding the
old lease or ending the activation. Test partial drafts, CI/head/association
misreporting, same-run recovery and stale-generation replay.
