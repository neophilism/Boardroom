# Blocked work and verified recovery

Boardroom omits a repository when it has no eligible approved work. A block on
one unit does not stop unrelated eligible units in the same repository.
Admission and same-repository PR chaining use the same technical recovery rule.
Privileged writes and merges recheck that rule under the current lease lock.

## Engineering questions

A scoped unresolved Coffee question holds its work unit, including work with
an existing open PR. Every unresolved question must be answered with source
evidence before an activation may investigate the proposed resolution.
An old answered question cannot hide another open question.

If an investigation ends BLOCKED, answers posted before that attempt started
cannot trigger repeated retries. A new source-backed answer is needed.
Interrupted or yielded work retains its resume path; lease recovery is separate.
A question's deadline is not permission to retry without evidence.

Answer evidence permits investigation and approved source changes, not acceptance.
The worker must verify the answer and use the existing immutable-ADR resolution
flow. Owner actions, source prerequisites, CI, review and fencing remain gates.
A BLOCKED unit with no actionable question remains excluded; do not clear it
by inventing an answer or changing its source status locally.

The private audit records question/answer events, terminal run outcomes, claim
and advancement reasons. The recovery rule uses those durable assignment
outcomes rather than model memory. Runtime identifiers and owner details belong
in private checkpoints and events, never this public source repository.

## Owner and dependency blocks

OPEN, ACKNOWLEDGED, AWAITING_VERIFICATION and DECLINED owner actions remain
blocking. Only verified fulfillment or an explicit cancellation removes that
owner prerequisite. Local and cross-repository prerequisites must still be
approved and observed merged/accepted. Recheck actual prerequisite state when
it changes; no manual queue reset is needed after verified fulfillment.

## Expired and unknown execution

An expired lease remains held. Wall-clock expiry cannot establish termination.
The existing owner recovery operation requires confirmation that outside
execution stopped or was isolated, revokes the old credential, increments the
fencing generation, releases the assignment and records an audit event.
Only that verified recovery path can make the repository selectable again.
Technical answers and owner-action status cannot release another run's lease.

## Verification

The PostgreSQL recovery integration suite exercises the actual selector and
write prerequisite query with open questions, evidence-free answers, consumed
answers, multiple questions, verified owner resolution and fenced recovery.
Gateway regression tests verify that a new technical block stops both writes
and merges before any GitHub request. Existing dependency, concurrent lease,
and recovery suites continue to apply.
