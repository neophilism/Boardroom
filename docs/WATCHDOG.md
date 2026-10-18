# BR-052 / BR-053 — Session diagnosis and fenced recovery

The private `POST /api/v1/internal/watchdog` endpoint accepts a separate
`BOARDROOM_WATCHDOG_TOKEN`. The authenticated internal maintenance tick also
runs the watchdog. The maintenance GitHub Action is scheduled every ten minutes
and on main-branch pushes, but GitHub scheduling is best-effort. A missed cron
delivery must not strand a recoverable native ChatGPT activation indefinitely.

## Arrival recovery and truthful busy responses

Admission locks the authenticated credential and its current run. A fresh
lease remains exclusively owned by that run. A duplicate delivery with an
existing trusted activation key is always a replay and never triggers recovery
or grants a second execution. An abandoned ADMITTED run can be retired after
ten minutes only when it holds neither an open assignment nor a repository lease.

When a new ChatGPT arrival finds a recovery condition, the server performs one
bounded scan and OAuth recovery pass for **that authenticated credential only**.
The pass shares the admission transaction and connection. Competing arrivals
cannot each skip the other's transient run lock and leave both activations
stranded. Once recovery succeeds, ordinary admission issues a fresh run ID in
the same transaction; it never hands the arriving agent the prior run's authority.

Both HTTP and MCP busy responses include `activeSession.startedAt`,
`lastSeenAt`, `leaseExpiresAt`, and a diagnosis. They expose no existing run ID
or lease generation, and always return `runId: null` and `shouldWork: false`.

| Diagnosis | Meaning |
| --- | --- |
| `ACTIVE_LEASE` | A RUNNING session still holds an unexpired lease; this is an overlap. |
| `ADMISSION_IN_PROGRESS` | A recent ADMITTED session has not yet claimed work. |
| `EXPIRED_LEASE` | The run still says RUNNING but its lease has expired; a locked in-flight write may defer the scan. |
| `MISSING_LEASE` | The RUNNING row has no matching lease and requires reconciliation. |
| `RECOVERY_HELD` | Recovery is pending, an external effect is unresolved, or an inconsistent admission still holds authority. |

`ALREADY_ACTIVE` is used only for the first two diagnoses. Expired or missing
leases and held recovery return `RECOVERY_REQUIRED`. A live lease is evidence
of active authorization; code progress and successful CI still require their
own source evidence.

## Native OAuth fencing

The scan locks run rows before lease rows and rechecks the lease. Lease rows
use `SKIP LOCKED`: an in-flight gateway write is deferred instead of blocking
the rest of the pass. The scan moves expired RUNNING sessions to RECOVERING
and writes an audit event. Native OAuth recovery is a server operation, so the
scan does not create a human approval request for it.

Recovery can release an OAuth-backed ChatGPT session only when its lease
expired at least sixty seconds ago, its registered credential remains enabled,
an unrevoked OAuth grant exists, its assignment and lease generation still
match, and no GitHub operation has an unresolved INTENDED or UNCERTAIN result.
Under the lease lock, a bounded read-only GitHub reconciliation can resolve
recorded effects from exact source evidence; legacy or unprovable effects remain held.
The transaction marks the old run CANCELLED, increments its lease generation,
releases the assignment, resolves any existing recovery card, and writes a
private audit event. The reusable OAuth credential and grant are preserved.

This fences Boardroom write authority; it does not prove termination of a
remote ChatGPT conversation. Old run IDs and generations fail subsequent
privileged operations. Scheduled agents must use the Boardroom gateway for
repository mutations. Bearer/hosted workers remain on the separate recovery
path because Boardroom cannot infer termination or control outside credentials.
Unresolved native GitHub effects remain a technical reconciliation hold and
cannot be cleared merely because time elapsed.

No recovery path edits, disables, or reschedules recurring ChatGPT tasks.

## Verification

`tests-integration/native-oauth-recovery.test.ts` uses an isolated PostgreSQL
schema to verify fresh overlap, credential-scoped recovery, simultaneous
arrivals, the grace period, unresolved effects, lease-lock deferral, trusted
activation replays, orphaned admissions, connection preservation, and rejection
of late writes after a new assignment. Unit tests also cover diagnostic output
and the absence of routine native-recovery approval cards.

Maintenance reports stale classifications and OAuth releases separately.
Verify production revision, maintenance evidence, and a real subsequent
scheduled arrival before declaring an operational incident resolved.
