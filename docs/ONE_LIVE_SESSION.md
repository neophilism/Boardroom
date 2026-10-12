# One active session per named scheduled agent (BR-015)

Every recurring scheduled task uses the same standard work instruction, preceded by the name assigned by the owner. The name is bound to one registered credential. Every hourly activation is a fresh **attempt**, but only one nonterminal run for that credential may exist at a time.

## Arrival decisions

- **CREATED**: no active run; new run ID is issued and this execution may claim eligible repository work.
- **BUSY**: earlier execution is still active. No old run ID is returned, and this invocation must terminate without starting any work.
- **RECOVERY_REQUIRED**: old execution is not safely confirmed finished. New work is refused until recovery and fencing complete.
- **REPLAY**: duplicate delivery of a known activation key returns the existing record. It is an acknowledgment, not permission to launch a second execution for that run.

Arrival is serialized by locking the credential row inside a PostgreSQL transaction. A partial unique index on nonterminal runs provides an independent final backstop. An ADMITTED run that never obtained a repository assignment may be retired after ten minutes; an expired heartbeat alone never authorizes reassigning a still-running worker.

The provider's schedule itself might still spawn a process before discovering the previous one is active. Boardroom cannot suppress spawn inside a third-party scheduler; it can safely refuse a new assignment and instruct the process to terminate.

This is not a claim that a ChatGPT scheduled task can already make arbitrary API calls; live capability validation remains BR-004.
