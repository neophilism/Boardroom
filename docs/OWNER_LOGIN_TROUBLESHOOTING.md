# Owner login troubleshooting (BR-081)

The private owner login compares the **exact** entered value against the `BOARDROOM_OWNER_API_TOKEN` environment setting on the Boardroom Render web service. It is not the GitHub App private key, `BOARDROOM_SESSION_SECRET`, or `BOARDROOM_TOKEN_PEPPER`.

## Password format

Use a unique, high-entropy password-manager-generated token of at least 32 characters. The login accepts ordinary base64 passwords (including `+`, `/`, and `=`) and symbols; there is no base64url-only restriction. The value is compared **exactly**, without trimming, removing quotation marks, or changing case.

## Error behavior

- **401**: The submitted credential did not match the configured owner token. Compare it directly in trusted Render/password-manager interfaces. Verify the setting is named `BOARDROOM_OWNER_API_TOKEN`. Do not paste secrets into GitHub, chat, screenshots, or support requests.
- **503**: The server cannot complete login because the owner token or session-signing key is missing/invalid, or an unexpected server issue occurred. Check the protected Render environment and application logs.
- **400**: Missing or malformed submission.

No token text, token fragment, hashed fingerprint, or value length is logged. A green `/api/ready` only confirms required config values have sufficient length; it does not prove the user entered the correct token.

After login, open `/system` and use **Verify setup and import repositories**. Neither the login nor readiness implies that autonomous scheduled development has been verified.
