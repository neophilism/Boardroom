# Boardroom owner setup

The public root directs visitors to `/setup` when required runtime credentials are absent, instead of triggering an internal server error on protected pages. It is only a signpost to trusted provider consoles—not an online form for secret entry.

The one-time operator actions are also recorded as three **private Owner Action Board cards** in the dedicated Boardroom Neon database:

1. Supply `DATABASE_URL` using the existing Boardroom database's pooled URL in Render's secure environment.
2. Generate and enter distinct owner API, session signing, and credential-pepper secrets (32+ characters) into the same Render service.
3. Install the scoped Boardroom GitHub App and supply its IDs and PEM private key securely via Render environment settings.

[Boardroom Render environment](https://dashboard.render.com/web/srv-db6jnrlg1s2s739jt9ug) · [Neon console](https://console.neon.tech/)

No credentials belong in this repository, Owner Action description, Coffee Corner, chat, or an automated scheduled-task prompt. The `/api/ready` endpoint checks core runtime config and initial migration fingerprints, not GitHub App installation or provider's scheduled-task capabilities.
