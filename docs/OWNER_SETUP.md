# Boardroom owner setup

The public root directs visitors to `/setup` when required runtime credentials are absent, instead of triggering an internal server error on protected pages. It is only a signpost to trusted provider consoles—not an online form for secret entry.

The one-time operator actions are also recorded as three **private Owner Action Board cards** in the dedicated Boardroom Neon database:

1. Supply `DATABASE_URL` using the existing Boardroom database's pooled URL in Render's secure environment.
2. Generate and enter distinct owner API, session signing, and credential-pepper secrets (32+ characters) into the same Render service.
3. Install the scoped Boardroom GitHub App and supply its IDs and PEM private key securely via Render environment settings.

[Boardroom Render environment](https://dashboard.render.com/web/srv-db6jnrlg1s2s739jt9ug) · [Neon console](https://console.neon.tech/)

No credentials belong in this repository, Owner Action description, Coffee Corner, chat, or an automated scheduled-task prompt. The `/api/ready` endpoint checks core runtime config and initial migration fingerprints, not GitHub App installation or provider's scheduled-task capabilities.

## Verified system status

After adding your owner login token in Render, sign in at `/login` and open `/system` for server-side, non-secret operational checks. It verifies the Neon schema, registered names, outstanding Owner Actions, and actual GitHub App installation access, and never confuses these infrastructure checks with a tested scheduled-agent workflow. If the GitHub App is installed and authenticated, use `Refresh from GitHub` on the private Work Board to import real repositories. Keep this page owner-only.
