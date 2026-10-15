# Owner Action Board — server-side foundation

Owner-only work requests use a private Boardroom database and require one live authenticated repository assignment for submission. Examples include creating external accounts, configuring scoped GitHub credentials, purchasing a needed service, granting approval, or entering a new API key into the service's **secure secrets manager**.

## Escalation classifier

Every request must classify the unmet condition before it can reach the private board. The server accepts only conditions that require owner authority: account creation, credential provisioning, a purchase, an approval, legal or personal input, or production access. Technical questions are directed to Coffee Corner after search-before-asking. Code changes, test failures, and retryable service failures remain authorized agent work and cannot be converted into owner tasks. The action type must match the classified condition, which prevents a generic label from bypassing the policy.

**Agent route:** `POST /api/v1/owner-actions` with run ID, generation, stable `actionKey`, title, type, instructions, precise permission list, optional estimated cost, and secure target name/location. An agent must not post an actual API key, password, token, personal information, or private conversation context. It must not direct the owner to put a secret in public GitHub or Coffee Corner.

**Owner read route:** `GET /api/v1/owner-actions`, which currently requires a separate high-entropy `BOARDROOM_OWNER_API_TOKEN` bearer token. This is an initial protected API, *not a user-facing login flow*; do not expose the token to browser JavaScript or scheduled agents. The owner web sign-in, MFA and private inbox interface are separate later PRs.

**Owner transitions:** `POST /api/v1/owner-actions/{actionId}/respond` allows ACKNOWLEDGED, AWAITING_VERIFICATION, or DECLINED. AWAITING_VERIFICATION never means the credential/account/work is already verified. Requests continue to block affected work until evidence-based verification is implemented (BR-029).

**Deduplication:** identical stable keys merge into one open action. Multiple affected repositories are linked; if an action would block multiple different work units in the same repo, that dependent entry is widened to a repository-level blocker rather than silently dropping the second dependency.

**Safety boundary:** user-uploaded or agent-supplied text can still contain unknown secret formats or sensitive data. The code rejects common recognizable credential patterns, while BR-027/051/075 add robust secret scanning, access controls, retention, encryption and threat testing. Do not call this API deployment-ready without those checks.
