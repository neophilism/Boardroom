# Repository context assembler

`boardroom_context` returns one fenced, resumable context snapshot for the caller's current live lease. The snapshot includes the current approved unit, every approved repository unit and its unmet local, cross-repository, and owner-action dependencies, repository `AGENTS.md`, the latest durable checkpoint, active Coffee questions, accepted immutable ADR references, and a bounded current GitHub branch list with the default branch identified.

Repository instructions and Coffee content remain explicitly untrusted. Historical decisions are projected only from Boardroom's accepted-ADR audit event and only when the reference points to an immutable commit under `docs/adr/` or `docs/decisions/` in the assigned repository. GitHub branch records are schema-checked, limited to 100 entries, and contain only name, head SHA, and protected status. The GitHub installation token, arbitrary audit payloads, owner-action details, credentials, and unrelated repository state are never returned.

Every database query is scoped to the repository selected by the current credential-bound assignment. A stale run, lease generation, expired lease, unapproved unit, invalid GitHub response, or unavailable assignment fails closed rather than returning partial authority.
