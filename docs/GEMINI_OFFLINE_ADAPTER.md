# BR-093 contribution — Gemini stateless Interactions adapter ($0)

**Status:** offline protocol foundation only; BR-093 full acceptance remains pending BR-087/089 funded spend/identity/lease gates. The adapter in `src/runner/gemini-interactions.ts` is not imported into the existing hosted runner, has no provider-key environment loader and requires explicit injected transport. GitHub tests use only mocked responses.

Official references reviewed October 18, 2026:
- https://ai.google.dev/gemini-api/docs/function-calling — `store:false`, stateless full history with `user_input`, *all* returned model steps including `thought`, `function_call`, then `function_result` using `call_id`.
- https://ai.google.dev/api/interactions-api.md — `POST /v1beta/interactions`, `x-goog-api-key`, `generation_config`, status `requires_action` / `completed`, `total_input_tokens`, `total_output_tokens`, `total_cached_tokens`, `total_thought_tokens`.

The adapter serializes all model steps unchanged, validates tool names/IDs against the supplied allowlist, refuses built-in paid tools, rejects unknown/async statuses, requires all function results exactly once and preserves Google's distinct token counts with explicit provenance. No cached/opaque thought details are shown in UI or logs. Provider error text is never exposed.

**Limitations:** The current runner charges using generic model configured input/output rates and cannot yet account for Google tool-use or thought billing, guaranteed data retention, vendor rate limits or model-native effort. Therefore do not wire this into production activation until BR-086/087/089/093/095 provide audited metering, expense cap, owner-funding approval and a qualified pinned model. Offline CI cannot establish real-credential compatibility.
