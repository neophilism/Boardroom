# GitHub App private key formatting and authentication

Boardroom uses a private RSA PEM generated under your GitHub App, not the App ID, installation ID, webhook secret, or a personal token.

## Secure owner setup

1. Open GitHub Settings > Developer settings > GitHub Apps > your Boardroom App > General.
2. Under Private keys, generate/download an original .private-key.pem if you do not have the existing original. A newly generated key is valid for that same App; neither app nor installation needs to be recreated.
3. Open the PEM in a local plain-text editor. It must begin with -----BEGIN RSA PRIVATE KEY----- (or -----BEGIN PRIVATE KEY-----) and finish with the corresponding -----END ... PRIVATE KEY----- line. Copy everything between and including those lines; not just the middle base64 data.
4. Go to the Boardroom Render service environment: https://dashboard.render.com/web/srv-db6jnrlg1s2s739jt9ug . Edit only BOARDROOM_GITHUB_APP_PRIVATE_KEY, pasting original PEM in the protected value field. Prefer original multiline text without quote characters. Save and deploy.
5. Confirm BOARDROOM_GITHUB_APP_ID is the numeric App ID from the same GitHub App. BOARDROOM_GITHUB_INSTALLATION_ID is the separate numeric installation ID from the installed App.
6. Open the private System Status page at https://boardroom-iamn.onrender.com/system and run Verify setup and import repositories.

Boardroom also supports escaped backslash-n line breaks, Windows line endings, and paired quote wrappers. It fails closed for corrupted, truncated, encrypted, public-key, or non-RSA PEM values. No secret content or fingerprints are returned or logged.

PRIVATE_KEY_INVALID is a local JWT signing failure, before any GitHub API call. APP_AUTH_REJECTED means GitHub rejected a signed JWT: check the App ID matches the App that issued the key. INSTALLATION_NOT_FOUND indicates the separate installation ID needs correction.

Never post the PEM in chat, GitHub issues, PR comments, screenshots, Coffee Corner, or public logs. Signing is only the first check; GitHub must accept the installation and expose authorized repositories.
