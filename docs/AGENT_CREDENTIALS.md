# Owner-issued named scheduled-agent credentials (BR-080 follow-up)

Once the Boardroom Render service is configured, sign in as owner and visit `/agents`.

Choose one unused label from the exact 601-name roster, select the intended AI provider, and click **Create agent credential**. The browser displays a fresh 384-bit random bearer token **once** over the signed-in HTTPS session. The database stores only a keyed HMAC-SHA256 digest using `BOARDROOM_TOKEN_PEPPER`; the raw credential is not logged or persisted. Store it in a supported external worker or integration secret manager; do not put the credential in a GitHub repository, Coffee Corner, a scheduled task's plain-text instructions, or a shared link.

A registered identity is uniquely bound to its exact approved name. The owner may revoke an active credential, immediately denying future authenticated Boardroom operations. To rotate, revoke first and then register the name again. Revocation and issuance create private audit events.

**Important:** ChatGPT scheduled tasks may not expose per-task secure secret storage or arbitrary outgoing API calls. The issuance screen does not solve this platform limitation. BR-004 must prove a supported direct connector or safe external worker integration before suggesting that all 50 scheduled tasks can autonomously write code. The common agent prompt may safely contain the assigned name only, never a bearer token.

Private APIs: `GET /api/v1/owner/agents` lists active labels; `POST /api/v1/owner/agents` with `{"name":"Smith","provider":"chatgpt"}` issues one credential; `POST /api/v1/owner/agents/{credentialId}/revoke` revokes one. Owner authentication and same-origin mutation protections apply.
