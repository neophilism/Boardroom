# Connect one native ChatGPT scheduled worker

Boardroom now has an opt-in OAuth authorization-code flow for ChatGPT's authenticated remote MCP connection. This uses the existing Render service and owner sign-in. It does not require a new identity-provider account or an OpenAI API key. It does not establish that a scheduled task has successfully worked; the actual native trial remains BR-004/042 acceptance.

## Owner setup

1. Finish GitHub App verification/import on `/system`.
2. On `/agents`, register one unused exact approved name with provider `chatgpt` and connection method **Native ChatGPT OAuth**. This returns no bearer secret to copy. Registration alone grants no connection; owner consent and PKCE exchange are still required. Use `/launch` for the five-agent checklist and shared instruction.
3. In the existing Render service set `BOARDROOM_OAUTH_ENABLED=true`. The intended release and its complete current migration inventory must be live and ready first. Existing owner/session/pepper secrets are reused securely; no secret is copied into source.
4. In ChatGPT Plugins, select the plus button and **Add custom MCP server**. Enter the Boardroom server URL `https://boardroom-iamn.onrender.com/api/mcp`, choose OAuth and the supported CIMD/public-client method, review the connection permissions, and create/install the personal plugin. Discovery identifies the existing Boardroom issuer; no client secret is required for its PKCE public-client flow.
5. Authenticate the connection. The Boardroom popup asks for the existing owner sign-in, then explicit consent for a selected registered named agent. Choose the intended name. Each additional connection can be approved for a different named agent. Its identity comes from that consent and token binding, never the task's name claim.
6. In a normal Work chat invoke the Boardroom plugin, inspect `boardroom_profile`, and verify its exact name before check-in. Test arrival, claim, context/source, useful fenced work, independent checks/PR, checkpoint and release on an authorized repository.
7. Only after that manual prompt works, schedule one activation using the common instructions in `SCHEDULED_AGENT_PROTOCOL.md`. Record the actual scheduled run, assignment, PR/head/CI, checkpoint and terminal outcome privately. Capture any platform approval pauses; do not describe an approval-blocked run as unattended.
8. Expand to further named connections/accounts only after exclusivity, recovery and the first useful loop pass. The server retains one live session per named credential and one writable repository assignment per run.

## Consent submission troubleshooting

The consent document uses `Referrer-Policy: same-origin`. Native HTML form POSTs
under `no-referrer` send `Origin: null`, which the owner CSRF guard correctly
rejects. The page policy preserves same-origin provenance and suppresses
cross-origin referrers; the authorization redirect still uses `no-referrer`.
Do not fix this by accepting null origins or disabling the owner origin guard.
Consent now submits through a fresh CORS-mode `fetch`, with same-origin cookies
and an `Accept: application/json` response. This avoids native navigation origin
handling and keeps any OAuth callback out of fetch redirect following. The
client validates the fixed ChatGPT callback, issuer and state before navigating.
Buttons remain disabled until the client handler is ready; ambiguous POSTs are
never automatically retried. JavaScript is required for this consent UI.

Consent failures return a stable `code` and `nextAction` without request values
or exception text. `CONSENT_ORIGIN_REJECTED` also supplies a fixed `diagnostic`
(`NULL_ORIGIN`, `ORIGIN_MISMATCH`, `FETCH_SITE_REJECTED`, or `PROVENANCE_MISSING`),
without exposing raw request headers. `OWNER_SESSION_REQUIRED` requires owner sign-in and a new connection
attempt. `CONSENT_TEMPORARILY_UNAVAILABLE` identifies client verification
availability. A retry must still complete the real ChatGPT OAuth exchange;
local tests do not establish native connection or scheduled-development acceptance.

After `npm run build`, run
`node --experimental-strip-types scripts/verify-consent-http.mjs` for the
production HTTP transport regression. It uses only a fixture owner session and
client document, exercises a denial callback, and verifies rejection of null,
foreign and cross-site origins plus anonymous access. It creates no real grant
and does not require database credentials. The CI verification job runs it.

## Trial evidence and handoff

Keep activation evidence in the private Boardroom checkpoint and session timeline.
Do not put run IDs, assignment IDs, owner requests, OAuth details or private
operational logs in this public repository. A source PR may contain the trial
procedure and code fixes; it does not itself prove a scheduled activation.

For each trial, record:

- **Invocation:** manual or genuinely scheduled, actual start time, verified
  profile name, and the supported tool connection. Do not infer scheduled origin
  from a prompt, schedule creation, a heartbeat or a manually supplied label.
- **Admission and assignment:** the actual arrival result, claimed repository,
  approved unit and fencing generation. Retain the active session identifiers
  privately. A busy response has no run ID and grants no work authority.
- **Execution:** immutable source SHA, remote branch, commit and mapped PR URLs.
  Distinguish a branch-only transport check from a useful source change.
- **Verification:** actual checks for the current committed PR head, outstanding
  checks and their real conclusions. Record platform approval prompts, unavailable
  tools, runtime limits and refresh failures without secret values.
- **Handoff:** remaining approved work and exact next action, followed by the
  checkpoint response and truthful terminal outcome. Confirm assignment release.
  If a write outcome is ambiguous, inspect remote state before retrying it.

A first manual activation should also attempt another arrival while the original
lease is healthy. Expect `shouldWork: false`, `runId: null` and
`ALREADY_ACTIVE`; continue only under the original run and generation. This
tests duplicate admission without transferring or releasing its authority.

Schedule one connected identity only after the useful manual path is verified.
Use the common instruction unchanged. The next activation must read the durable
checkpoint, reconcile any existing PR at its current head, and resume that work
rather than create a duplicate PR. Keep the first schedule as a trial until
actual scheduled execution, useful GitHub work, safe release and later resume
are observed. Record an approval-blocked run as blocked, not unattended.

BR-004 requires a genuine scheduled invocation, assignment and reported result.
BR-042 additionally requires a working code change, tests, mapped PR, checkpoint
and release from the actual scheduled path. A successful manual connection,
green setup CI, scheduled reminder or saved checklist cannot pass either gate.

## Check-suite metadata during the trial

GitHub's automatic app flow can leave a queued Render suite with zero check
runs on a branch that Render does not deploy. This is a provider placeholder,
not evidence that a test ran. The collector keeps it visible with assessment
role `EMPTY_PROVIDER_SUITE` only when GitHub identifies the exact Render app
(ID 14658, slug `render`), the suite is queued without a conclusion, its
reported run count is exactly zero, and every observed run has complete app
and suite identifiers that do not contradict that count.

A placeholder alone yields `NO_CHECKS`. Missing or contradictory metadata,
unknown apps, actual Render runs, failed suites, incomplete pages, and all
real pending or skipped checks retain their existing blocking behavior.
Every configured required check must still have its own successful execution,
GitHub merge requirements must pass, and Boardroom changes still require the
owner's review at the current head.

The automatic suite/request flow is documented in
https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks .
The narrow Render case does not authorize ignoring arbitrary queued suites.

## Protocol and security boundaries

Only the published fixed OpenAI CIMD client and stable callback are supported in this first implementation. The server verifies that public metadata over HTTPS with redirects disabled. It advertises matching issuer/resource identifiers, S256 PKCE, `none` token-endpoint authentication, authorization-code and refresh grants, and the single `boardroom:agent` scope. Initialization/tool schemas are public; operational tools require a scoped token.

Authorization codes expire in two minutes and are consumed once. Access tokens expire after 15 minutes. Thirty-day refresh tokens rotate once per use; replay revokes the entire grant. The database stores only domain-separated keyed token/code hashes. Disabling a named credential immediately denies its OAuth access. Tokens cannot grant owner administration or bypass lease fencing, source path restrictions, required checks, reviews or repository policy. OAuth remains disabled until explicitly enabled and linked by the owner.

Native tasks use the connected ChatGPT account's supported runtime and usage limits. The hosted API runner and its separately authorized financial caps remain an alternative integration. No paid API job is enabled by this source change.

## Official interface references checked October 13, 2026

- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://learn.chatgpt.com/docs/automations

The live OpenAI CIMD document was independently retrieved and matched the fixed client ID, stable callback and supported `none` authentication method. This verifies the public client contract, not Boardroom's private connection or a scheduled run.
