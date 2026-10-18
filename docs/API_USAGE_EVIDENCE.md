# BR-086 contribution — append-only per-model usage evidence

The new `api_usage_evidence` table is an independent event ledger, not a billing ledger and not an executable agent scheduler. Schema migration `0016_api_usage_evidence.sql` is additive. It preserves per-call/provider/model revision, raw token counts and nullable cache/reasoning/tool counts. A unique `(run_id,operation_key,provenance)` prevents conflicting duplicate events. A 64-character SHA256 of the validated, sanitized evidence envelope detects replay mismatch. Never hash or store raw provider transcripts, secrets, API keys, personal data or user prompts.

`appendProviderUsage` is **internal-only** (no HTTP handler) and requires a pre-existing verified agent run; when a logical agent ID is supplied, the secure run-to-agent provenance link must already exist. It accepts only `PROVIDER_RESPONSE` evidence, refusing all model-provided USD amounts and unverifiable invoice statuses. Optional/unknown amounts remain SQL `NULL`; it does not claim that unmetered work is free.

Prices (including caching/thinking, tool fees, possible minimums), reservations, ownership/tenant attribution, provider invoice reconciliation, per-agent budget enforcement and supported billing importers remain BR-087/096/097/109/117 work. This PR does not connect the existing runner to the table; that must be done after BR-087 has independently enforced no-spend budget reservations and authentic provider run correlation. No provider calls or cloud resources are introduced.

CI should verify immutable migration manifest, constrained PostgreSQL schema, idempotent replay, rejecting wrong run linkage, provenance and token validation. Do not present this as verified external billing.
