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

## Protocol and security boundaries

Only the published fixed OpenAI CIMD client and stable callback are supported in this first implementation. The server verifies that public metadata over HTTPS with redirects disabled. It advertises matching issuer/resource identifiers, S256 PKCE, `none` token-endpoint authentication, authorization-code and refresh grants, and the single `boardroom:agent` scope. Initialization/tool schemas are public; operational tools require a scoped token.

Authorization codes expire in two minutes and are consumed once. Access tokens expire after 15 minutes. Thirty-day refresh tokens rotate once per use; replay revokes the entire grant. The database stores only domain-separated keyed token/code hashes. Disabling a named credential immediately denies its OAuth access. Tokens cannot grant owner administration or bypass lease fencing, source path restrictions, required checks, reviews or repository policy. OAuth remains disabled until explicitly enabled and linked by the owner.

Native tasks use the connected ChatGPT account's supported runtime and usage limits. The hosted API runner and its separately authorized financial caps remain an alternative integration. No paid API job is enabled by this source change.

## Official interface references checked October 13, 2026

- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://learn.chatgpt.com/docs/automations

The live OpenAI CIMD document was independently retrieved and matched the fixed client ID, stable callback and supported `none` authentication method. This verifies the public client contract, not Boardroom's private connection or a scheduled run.
