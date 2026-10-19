# Private agent account email registry

Record the provider account email during **every new registration** at the owner-only /agents page. This is the ChatGPT or other provider account in which the named worker is connected, not a Boardroom owner email or a GitHub address.

For an existing agent use **Edit email** on /agents. The owner-only /launch page shows the account beside each name, allowing quick account switching during incident response. The ChatGPT link opens the provider site; the user must select the displayed email in the provider account switcher.

The email lives only in Neon `agent_credentials.account_email`. No real address belongs in public GitHub source, scheduled-agent instructions, access tokens, logs or public audit bodies. The account is owner-declared metadata; it is neither proof of ownership nor an authentication factor. Access to the owner pages and PATCH API requires an authenticated owner session and same-origin mutation protection. Legacy records may be null until backfilled; new registrations require valid email input.

API: register with `{"name":"Smith","provider":"chatgpt","authentication":"oauth","accountEmail":"user@example.test"}`; update using `PATCH /api/v1/owner/agents/{credentialId}` with `{"accountEmail":"user@example.test"}`.
