# Owner Action Board — server-side foundation

Owner-only work requests use a private Boardroom database and require one live authenticated repository assignment for submission. Examples include creating external accounts, configuring scoped GitHub credentials, purchasing a needed service, granting approval, or entering a new API key into the service's **secure secrets manager**.

## Escalation classifier

Every request must classify the unmet condition before it can reach the private board. The server accepts only conditions that require owner authority: account creation, credential provisioning, a purchase, an approval, legal or personal input, or production access. Technical questions are directed to Coffee Corner after search-before-asking. Code changes, test failures, and retryable service failures remain authorized agent work and cannot be converted into owner tasks. The action type must match the classified condition, which prevents a generic label from bypassing the policy.

## Structured templates

The `boardroom_owner_action_from_template` tool provides four executable request templates: external account, scoped credential, purchase, and approval. Every template requires an exact target system, requested action, prerequisites, and verification method. Credential requests additionally require a minimum permission list and secure secret-entry location; purchase requests require an expected expense. Boardroom renders these fields into a concise private request and passes it through the same owner-only classifier and secret screening as the lower-level route.

**Agent route:** `POST /api/v1/owner-actions` with run ID, generation, stable `actionKey`, title, type, unmet-condition classification, instructions, precise permission list, optional estimated cost, and secure target name/location. An agent must not post an actual API key, password, token, personal information, or private conversation context. It must not direct the owner to put a secret in public GitHub or Coffee Corner.

**Owner read route:** `GET /api/v1/owner-actions`, which currently requires a separate high-entropy `BOARDROOM_OWNER_API_TOKEN` bearer token. This is an initial protected API, *not a user-facing login flow*; do not expose the token to browser JavaScript or scheduled agents. The owner web sign-in, MFA and private inbox interface are separate later PRs.

**Owner transitions:** `POST /api/v1/owner-actions/{actionId}/respond` allows ACKNOWLEDGED, AWAITING_VERIFICATION, or DECLINED. AWAITING_VERIFICATION never means the credential/account/work is already verified. Requests continue to block affected work until evidence-based verification is implemented (BR-029).

**Deduplication:** identical stable keys merge transactionally into one open action, including when different repositories submit concurrently. The key identifies the exact shared prerequisite and must not contain a repository-specific suffix when the same account, credential, purchase, approval, or configuration unblocks several projects. The private owner list returns every affected repository's stable ID and full name in deterministic order; if an action would block multiple different work units in the same repo, that dependent entry is widened to a repository-level blocker rather than silently dropping the second dependency.

**Safety boundary:** user-uploaded or agent-supplied text can still contain unknown secret formats or sensitive data. The code rejects common recognizable credential patterns, while BR-027/051/075 add robust secret scanning, access controls, retention, encryption and threat testing. Do not call this API deployment-ready without those checks.
