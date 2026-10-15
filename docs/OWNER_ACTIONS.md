# Owner Action Board — server-side foundation

Owner-only work requests use a private Boardroom database and require one live authenticated repository assignment for submission. Examples include creating external accounts, configuring scoped GitHub credentials, purchasing a needed service, granting approval, or entering a new API key into the service's **secure secrets manager**.

## Escalation classifier

Every request must classify the unmet condition before it can reach the private board. The server accepts only conditions that require owner authority: account creation, credential provisioning, a purchase, an approval, legal or personal input, or production access. Technical questions are directed to Coffee Corner after search-before-asking. Code changes, test failures, and retryable service failures remain authorized agent work and cannot be converted into owner tasks. The action type must match the classified condition, which prevents a generic label from bypassing the policy.

## Structured templates

The `boardroom_owner_action_from_template` tool provides four executable request templates: external account, scoped credential, purchase, and approval. Every template requires an exact target system, requested action, prerequisites, and verification method. Credential requests additionally require a minimum permission list and secure secret-entry location; purchase requests require an expected expense. Boardroom renders these fields into a concise private request and passes it through the same owner-only classifier and secret screening as the lower-level route.

**Agent route:** `POST /api/v1/owner-actions` with run ID, generation, stable `actionKey`, title, type, unmet-condition classification, instructions, precise permission list, optional estimated cost, and secure target name/location. An agent must not post an actual API key, password, token, personal information, or private conversation context. It must not direct the owner to put a secret in public GitHub or Coffee Corner.

**Owner read route:** `GET /api/v1/owner-actions`, which currently requires a separate high-entropy `BOARDROOM_OWNER_API_TOKEN` bearer token. This is an initial protected API, *not a user-facing login flow*; do not expose the token to browser JavaScript or scheduled agents. The owner web sign-in, MFA and private inbox interface are separate later PRs.

**Owner transitions:** `POST /api/v1/owner-actions/{actionId}/respond` allows ACKNOWLEDGED, AWAITING_VERIFICATION, DECLINED, or a return to OPEN with a required clarification note. Declines also require a reason and remain blocking rather than silently authorizing the work. AWAITING_VERIFICATION never means the credential/account/work is already verified. Only a server-side verifier with bounded evidence may finalize ordinary fulfillment; exact risk approvals keep their separate single-use verifier.

**Deduplication:** identical stable keys merge transactionally into one open action, including when different repositories submit concurrently. The key identifies the exact shared prerequisite and must not contain a repository-specific suffix when the same account, credential, purchase, approval, or configuration unblocks several projects. The private owner list returns every affected repository's stable ID and full name in deterministic order; if an action would block multiple different work units in the same repo, that dependent entry is widened to a repository-level blocker rather than silently dropping the second dependency.

**Safety boundary:** user-uploaded or agent-supplied text can still contain unknown secret formats or sensitive data. The code rejects common recognizable credential patterns, while BR-027/051/075 add robust secret scanning, access controls, retention, encryption and threat testing. Do not call this API deployment-ready without those checks.

## Private detail and evidence view

Each inbox title links to `/owner-actions/{actionId}`, an owner-session-protected page that presents the classified reason, lifecycle-derived urgency, full instructions, exact permission or secret scope, secure-entry destination, affected repositories and work units, expected expense, and explicit HTTPS links. Unknown or malformed action IDs return the private application's not-found response. The page never attempts to render a secret value and does not weaken the separate verification boundary.


## Secure credential handoff

Credential owner actions use structured references such as `render://services/boardroom-production/GITHUB_TOKEN`; the reference identifies a provider location and secret name, never the secret value. The server accepts only approved Render, GitHub Actions, and Boardroom runtime references with no extra fields. Verification is allowed only while the exact credential action is awaiting verification and only when the reference matches its approved secure-entry destination.

A provider adapter receives the private reference and the capability list already stored on the owner action. The agent-visible result contains only presence, the subset of requested capabilities actually verified, a boolean outcome, and an opaque bounded evidence ID. Extra provider capabilities are discarded, malformed evidence fails closed, and audit records omit the locator and secret name. Provider adapters must never return or log credential material. When every requested capability is present, this probe calls the BR-029 fulfillment resolver. The resolver locks the action, accepts only AWAITING_VERIFICATION, records the bounded provider evidence, marks the action VERIFIED, and returns every affected repository/work-unit scope as requeued. The normal claim and privileged-write checks already treat VERIFIED as satisfied, so all dependents become eligible without a follow-up prompt to an agent. Missing or under-scoped capability evidence leaves the action blocking.


## Explicit risk approvals

Scheduled agents must request an exact owner approval before spending, destructive work, privilege changes, legal or political risk, or a production release. The `boardroom_risk_approval_request` tool canonicalizes the category, target, exact action summary, and maximum cost (required only for spending) into a content-addressed private action key. Changing any field requires a new approval.

Risky adapters must call the server-side approval guard with the authenticated run, credential, and lease generation. The guard derives the current repository and work unit from the live lease, accepts only the matching `VERIFIED` approval attached to that scope, locks it, and records a secret-free consumption event before invoking the adapter. Each approval is single-use; concurrent or repeated attempts fail closed. A failed adapter attempt does not restore the approval because silently replaying spending or destructive work is less safe than requiring the owner to approve a retry.


## Fulfillment, clarification, and requeueing

Ordinary account, credential, purchase, and human-input tasks become VERIFIED only through `resolveVerifiedOwnerAction` with a supported verifier's positive bounded evidence. The resolver rejects owner approvals, unverified results, secret-shaped evidence identifiers, wrong lifecycle states, and duplicate finalization. It locks the action before updating it and writes one audit event containing the exact dependent repository/work-unit scopes that are re-enabled.

Owner clarification returns an acknowledged or awaiting-verification request to OPEN and requires a secret-free explanation. Rejection requires an explanation, becomes final, and deliberately remains a prerequisite blocker. Neither path asks an agent to treat an unsupported owner assertion as verification.
