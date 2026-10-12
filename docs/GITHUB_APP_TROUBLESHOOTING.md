# BR-083 — GitHub App connection diagnosis

After signing in, open the private [Boardroom System Status](https://boardroom-iamn.onrender.com/system) page. It now presents an **owner-only, non-secret connection diagnosis** when a configured GitHub App cannot authenticate.

The diagnosis is produced from controlled failure codes, not from raw provider responses or cryptography exceptions. App JWTs, installation tokens, PEM private keys, connection strings and other credential values remain private in Render. A green database status does **not** prove the GitHub App connection works.

## Exact settings to inspect

1. **App ID:** In GitHub → Settings → Developer settings → GitHub Apps → your Boardroom App → General, find the **numeric App ID**. It goes in the Render environment variable `BOARDROOM_GITHUB_APP_ID`, not the App's name, client ID or installation ID.
2. **Installation ID:** In GitHub → Settings → Applications → Installed GitHub Apps → Configure, the installation URL identifies the **numeric installation ID**. It goes in `BOARDROOM_GITHUB_INSTALLATION_ID`.
3. **Private key:** Under the same GitHub App's General settings, generate a PEM private key. Paste the **complete PEM including BEGIN/END lines** into `BOARDROOM_GITHUB_APP_PRIVATE_KEY` in Render. Actual newlines and escaped `\\n` sequences are supported; avoid enclosing literal quote characters. The key must belong to the App whose numeric ID is configured. Keep it exclusively in a secure secret facility.
4. **Owner:** Use `BOARDROOM_GITHUB_OWNER=neophilism`, corresponding to the organization or account whose repositories should be imported.
5. **App installation:** Install/authorize that App for at least one intended repository. Minimum permissions are Contents:write, Pull requests:write, Checks:read, Actions:read, plus implicit Metadata:read. Accept updated permission requests after changes.

After changing Render environment settings, let the new Render deploy finish, return to `/system`, and click **Verify setup and import repositories**. It will now report a specific failure category if GitHub rejects App authorization or no repositories are accessible. Do **not** send a private key, token or password in chat.

An App may authenticate and import repositories while autonomous scheduled-agent execution remains unverified.
