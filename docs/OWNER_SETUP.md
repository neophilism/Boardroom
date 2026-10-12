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


## One-click completion after setting Render credentials

Once the database settings, owner login token, and GitHub App configuration are saved, open the [private System status page](https://boardroom-iamn.onrender.com/system), sign in, and select **Verify setup and import repositories**. The server validates its Neon schema, GitHub App installation token, and whether at least one authorized repository is available. It then imports actual installed repositories in small batches from GitHub and reconciles their plans. The Owner Action Board updates the verified setup items based on real provider evidence.

A valid GitHub App credential **without any authorized repositories** is deliberately not considered a usable installation. No extra secret is copied to the browser or written to GitHub. An import failure stops visibly and leaves already imported records unchanged.

This one-click process **does not** prove that ChatGPT scheduled tasks can invoke Boardroom, execute source changes, or merge approved PRs without new approval. Those remain live integration acceptance tests.


## GitHub App permission verification

The private System Status page now checks the permission grants returned by the *actual installation-token issuance*, not merely the presence of Render variables. It requires Contents:write, Pull requests:write, Checks:read and Actions:read, plus at least one repository visible to the installation. If any scope is missing, System Status identifies the exact required permission. Update the GitHub App permissions and accept the revised installation authorization in GitHub before using **Verify setup and import repositories** again.

This permission check does not substitute for a live fenced GitHub write test; that remains a separate acceptance gate.
