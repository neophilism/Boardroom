# Scheduled-agent arrival API

All recurring scheduled tasks may use the **exact same instruction**. Agent identity is provided through independently provisioned tool/connector credentials, never by asking the language model to remember a task number, account number, or password.

`POST /api/v1/runs/arrive` with `Authorization: Bearer <provisioned-token>` creates a new transient run. Optional `Idempotency-Key` (12–128 safe characters) uniquely identifies an actual provider activation; retries using the same key return the existing run. If the provider does not expose a genuine stable activation key, omit it—do not manufacture a permanent key that would conflate separate hourly activations.

Credentials are registered in `agent_credentials`, stored as HMAC-SHA256 digests using a server-only `BOARDROOM_TOKEN_PEPPER` of at least 32 characters. No token is ever sent back in API responses or written to Boardroom chat, GitHub, or logs.

Initial provisioning, after migration:

1. Generate a cryptographically random 32-byte base64url token in a trusted administrative terminal or secrets tool.
2. Configure `BOARDROOM_TOKEN_PEPPER` in the Boardroom server secret store.
3. Pipe the token via stdin to `npm run register:agent -- '<label>' '<provider>'` with migration database authorization.
4. Place the token in the supported provider's **secure connected tool configuration**; do not paste it into the scheduled-task prompt.
5. Test an actual authorized scheduled activation. A normal conversation calling the endpoint manually is not proof of scheduled-task support.

**Not yet production ready:** endpoint has authentication and durable arrival records but no live deployment, IP/velocity limit, claim step, or verified ChatGPT scheduled-task connector. Never represent an arriving run as performing code development until it has obtained a repository assignment.
