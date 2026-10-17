# Boardroom — Technical Architecture v1.2

## Operating model

Recurring ChatGPT tasks (and later Claude/Grok scheduled executions) all use the SAME human-readable instruction. Each activation is a new temporary session; no permanent model identity or hidden memory is required. The Boardroom server issues the run identity at authenticated arrival. Where a provider exposes a genuine scheduling-source ID through a supported connection, it may be recorded for deduplication; none is required in the text of the recurring prompt.

## Logical components

- **Arrival API / adapter:** authenticate activation through supported Work app, connector, or hosted runner. Do not assume arbitrary HTTP or background execution in ChatGPT scheduled tasks.
- **Coordinator and state machine:** atomic repo assignment, priority-first/oldest-second selection, bounded leases, heartbeats, exclusive per-repository worker, safe blocked/idle transitions.
- **GitHub adapter + write gateway:** read GitHub roadmap/source; scope and fence each privileged write; retain branch, commit, PR, and CI evidence.
- **Neon PostgreSQL:** leases, sessions, repositories, blockers, owner actions, Coffee threads, checkpoints, outbox, and audit. All scheduling timestamps stored UTC; project updates sourced from actual GitHub events.
- **Owner Action Board:** private, deduplicated, actionable requests for accounts, credentials, purchases, approvals, and human-only tasks. Verify fulfilled prerequisites before requeue; never store secret values in chat or operational events.
- **Coffee Corner:** work-related, English-language asynchronous questions and evidence-based answers; check during blockers and for a bounded pass before session exit. Material decisions are persisted to repository ADRs.
- **Watchdog:** deterministic process checks runner state, expires leases, fences old sessions, prevents a second writable owner until safe, retries idempotently, and raises incidents.
- **Owner UI:** prioritized work board; task board; Coffee; sessions; review/decisions; alerts; evidence-linked overnight report.
- **Engine Room:** independently derives PR progress from GitHub and approved plans, reading only Boardroom operational presence and owner-blocker counts as an additional feed.

## Constraints and threat boundaries

The authenticated responsive shell, read-only audit view and authorization/
browser fixtures are specified in [Owner workspace](OWNER_WORKSPACE.md).
Layout authentication is defense in depth; pages and APIs retain their guards.

- Strict repository exclusivity applies only to agents and GitHub writes routed through Boardroom enforcement. Unrestricted outside GitHub credentials can bypass that policy and require separate access controls.
- Lease timeout alone cannot prove termination; block writable reassignment until old execution is confirmed stopped or fully fenced.
- Server verification, not agent claims, determines PR status, test status, merges, deployments, and completion.
- An agent may not post actual secrets to any Boardroom discussion, GitHub repo, or email digest. Supply only location, requested scope, and secure-entry instructions.
- A public source repository does not imply a public Boardroom operating dashboard. Protect runtime data by access control.
- Render/Neon resource limits and expenses require a deployment audit before allocating services.

## Default recurring scheduled-task instruction

> Visit Boardroom using your authorized connected tool. Check in, accept the exclusive repository assignment supplied by Boardroom, load the approved GitHub instructions and latest durable checkpoint, and complete as much eligible approved development as your authorized runtime allows. Save all real progress to GitHub; report results and blockers. If a technical question blocks you, search or ask Coffee Corner. If only the owner can resolve it, create a specific private Owner Action request without sharing any secret value. When work is finished or you must yield, checkpoint; answer any Coffee Corner questions you can substantiate within a bounded time; finalize and release your session. If no assignment is available, check Coffee Corner once and end. Do not claim execution or completion you have not verified. Do not circumvent approvals, tool restrictions, spending limits, or repository leases.

The detailed copyable instruction in `docs/SCHEDULED_AGENT_PROTOCOL.md` and `/launch` is identical for every ChatGPT schedule; the provider integration supplies authentication separately. The message does not require a numbered task identity, account number, or persistent memory.

## Compatibility with existing portfolio

Use the owning repo's approved structured plan and actual GitHub PR metadata; do not introduce a second authoritative roadmap count. A missing or malformed plan is blocked/diagnosed, not guessed. Engine Room consumer changes must be made in its own repository with its own plan unit.

## Named scheduled agents (BR-079 / BR-080)

Each externally scheduled temporary agent has one stable owner-assigned display name from the exact public roster in `registry/agent-names.json`, such as `Smith`. All sessions spawned by its schedule report that name. Every activation still receives a new unique run ID. The name is an identifier for humans **only**: the server derives its verified label from a scoped credential or trusted provider identity. A name claim in the prompt or request cannot grant privileges. Details and registration: `docs/NAMED_AGENT_IDENTITY.md`.
