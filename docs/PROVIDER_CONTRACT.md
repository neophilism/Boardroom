# BR-083 — versioned provider-independent interaction contract

This contract is a **zero-cost normalization layer** for existing mocked OpenAI Responses, Anthropic Messages and xAI Responses adapters. It does not provision credentials, enable hosted agents or call a provider as part of CI. Gemini and additional providers remain future BR-093/094 work.

`src/runner/provider-contract.ts` supplies:
- Strict normalized tool calls (bounded arguments, safe names and unique call IDs) with source protocol checks; unknown/untrusted provider output is never an executable instruction.
- Provider-reported token usage fields with explicit provenance, preserving cached input, cache creation and reasoning output counts **when actually returned**. Missing fields are `null`, not zero; values are not yet provider-invoice reconciliation.
- A size-bounded JSON reader capped at 2MB, so truncated, malformed or excessive provider content fails with a controlled code and without leaking a raw response body.
- Tool catalog validation and capped output token request. Existing provider model histories/continuations continue using their native tool-result payload shapes.

The legacy runner consumes the identical `inputTokens` and `outputTokens` fields and retains its conservative configured-token-price reservations. **Do not** claim this is exact vendor billing or cross-provider effort parity; BR-086/087 and BR-095 will address tier pricing, model-native effort, and reconciled usage.

Tests cover malformed protocol, duplicate/unknown call IDs, caching and reasoning usage, invalid token values, schema bounds and streamed size refusal. No model request is sent. Existing runner-provider conformance tests remain.
