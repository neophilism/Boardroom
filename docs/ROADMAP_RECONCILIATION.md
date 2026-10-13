# Reconciliation and work eligibility

The complete canonical dependency graph is validated before importing any work. Unknown/self dependencies, duplicate dependencies, cycles and IDs that cannot form a safe work branch fail verification. Validation handles large acyclic plans without recursive stack traversal.

A periodic source refresh preserves a local technical hold or in-progress unit when GitHub has no newer PR evidence. An open follow-up is not hidden by an earlier ACCEPTED state. Actual merged PR evidence can clear a local technical hold; it remains separate from full release acceptance.

If GitHub access or canonical-plan verification fails, inventory remains visible with an ERROR diagnosis, earlier units become ineligible, and old success timestamps are retained as historical evidence. A successful subsequent reconciliation restores only the units present in the verified canonical plan. No work is invented from a legacy or malformed source.

PostgreSQL regression coverage checks active/blocked preservation, follow-up reopening, safe invalidation and restored eligibility. These tests do not authorize a production agent or prove live unattended operation.
