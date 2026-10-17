# Transactional delivery and GitHub operation receipts (BR-055)

## Assignment dispatch

Claim and same-repository advance insert an `assignment_ready` outbox event in
the same PostgreSQL transaction as the assignment change. Its key includes the
assignment ID and unit ID. A rollback leaves neither an assignment change nor
its notification. Losing the claim response cannot lose that committed event.

The existing maintenance dispatcher delivers the event into the PostgreSQL
`assignment_dispatches` inbox. The existing authenticated context consumer can
also drain its own event immediately, so delivery does not depend on maintenance
running before a short lease expires. Both routes are idempotent. Receipt
acknowledgment keeps its original timestamp on repeated context requests.

This is **not** a new external-provider launcher. Native and hosted agents still
arrive through their authorized execution routes and claim their own assignment.
An inbox/outbox row is a notification, not a credential, lease extension, process
start, code completion or permission to replay expired work. An obsolete event
can finish without creating an inbox receipt. Context rechecks the current
credential, generation and lease before acknowledging delivery.

## Outbox ownership

Each claim receives a fresh random claim token. After five minutes a RUNNING
read/reconciliation job may be reclaimed. Completion and failure updates require
the same token and RUNNING state: an old worker cannot overwrite its successor's
DONE result or retry state. Read/reconciliation handlers remain at-least-once;
their authoritative GitHub refresh can repeat. Privileged source/merge mutations
are never executed by this generic maintenance dispatcher.

An inventory continuation and its parent's DONE transition commit together.
An interrupted completion rolls both back; replay uses the same continuation
key. Assignment inbox insertion and dispatch completion are likewise atomic.

## GitHub operation ledger

The fenced source gateway and merge path commit a `github_operations` INTENDED
record **before** an external mutation. The request identity is a canonical
SHA-256 digest scoped to the approved unit and repository. Bounded metadata
records the operation kind, paths and expected refs/PR number; it excludes
source text, commit messages, PR bodies, credentials and raw remote errors.

After that commit, a new transaction reacquires the repository lease lock and
checks the current run/credential/generation, assignment, pause state and approved
prerequisites. The merge path additionally retains all current-head check,
review, branch and owner/self-update approval gates. Ledger intent never
authorizes a mutation. Assignment changes between phases are rejected.

The existing adapters reconcile GitHub before a retried mutation: content
equality, exact parent/tree/message matching, existing branch/PR discovery,
ready-state reads, and an observed merged PR bound to the expected head. A
confirmed receipt is **not** blindly replayed as a current branch snapshot.
Repeated single-file requests are read-only unless exact content equality proves
the prior result; an outside deletion cannot cause an old intent to recreate a
file. PR discovery includes closed history, so a lost response followed by PR
closure cannot create a duplicate PR for the same branch.
Successful reconciliation/write and its CONFIRMED receipt/audit commit together.
An error leaves UNCERTAIN (or the previously committed INTENDED row if the DB is
unreachable); an ambiguous database commit never downgrades CONFIRMED.

Current-unit context exposes at most 50 unconfirmed descriptors for successor
handoff. A new authorized worker must inspect GitHub/source/checkpoints and
reconstitute the exact validated request when appropriate. The ledger does not
store executable source payloads or automatically send writes from an old run.
If current GitHub state cannot be reconciled, checkpoint and hold rather than
inventing a result or overwriting outside changes. Git trees are content-addressed;
safe staging reads/objects can repeat, but a successful source commit/ref change
must not be duplicated. No distributed exactly-once guarantee is asserted.

## Migration, checks and operational acceptance

`0013_operation_delivery.sql` is additive and fingerprinted in the migration
manifest. It adds outbox claim tokens, safe intent metadata, an assignment inbox
and an unconfirmed-operation index. Existing applied migrations are unchanged.
Old assignments without an outbox event remain readable; new claim/advance
transactions always enqueue. Deploy migrations before application code. Retain
other pending migrations (including separately developed 0012) when reconciling
parallel PRs; do not replace either manifest entry or edit applied SQL.

`tests-integration/operation-delivery.test.ts` applies the exact complete manifest
in its own randomized schema within the explicitly named `boardroom_test` DB.
It injects lost claim/remote responses, assignment rollback, stale claim tokens,
post-intent lease expiry and continuation completion failure. GitHub transport
is a controlled fixture for crash boundaries; production GitHub/provider process
death and deployed behavior are separate acceptance evidence, not inferred from
passing fixtures. No production queue, provider, database or paid resource is
created by these tests. The normal CI PostgreSQL and sandbox suites must pass
for the committed head. Source/CI completion is not deployment acceptance.
