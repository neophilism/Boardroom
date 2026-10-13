# Spending stops and truthful session finalization

An exhausted shared daily cap causes the hosted worker to checkpoint and yield before sending a model request. A missing/unapproved cap blocks the activation and creates one deduplicated private Owner Action with the required secure configuration location. A worker never raises its own spending cap. API/SDK budget codes are fixed values and do not include arbitrary provider error text.

Lost provider responses retain their full reservation. The PostgreSQL test verifies replay protection, refusal of a second call over the shared cap, settlement of known usage, serialization of simultaneous competing reservations and rejection of altered usage replays. These fixtures incur no provider charges.

An already-cancelled activation performs no check-in or model call. If a heartbeat fails, finalization waits for the in-flight heartbeat result and reports RECOVERY_REQUIRED instead of pretending the repository was safely released. Normal release still requires successful checkpointing and the server's fenced finish operation.

These are implementation and regression checks. An actual funded scheduled-worker trial, cancellation and private-owner escalation remain live acceptance gates.
