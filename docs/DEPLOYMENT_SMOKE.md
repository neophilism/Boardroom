# BR-077 — Live deployment smoke checks

A GitHub Actions workflow checks the **actual public Render service** at `https://boardroom-iamn.onrender.com` on main pushes, twice daily, and on manual dispatch. It uses only public GET requests and no repository or owner secrets.

Checks verify that `/api/health` returns genuine process liveness, `/api/ready` conservatively returns **200 ready** or **503 not ready**, `/setup` serves a safe public setup page, and private `/owner-actions`, `/agents`, `/system`, and the Owner Agent registry API refuse anonymous access.

Render sets `RENDER_GIT_COMMIT` at runtime; the health response returns only this public commit SHA to assist with troubleshooting. Because fast successive pushes can supersede deploys before checks finish, this workflow verifies the currently serving service, **not that the triggering commit is already deployed**. Use Render's deployment control plane for the exact current revision.

A passing smoke check is not proof that owner authentication works, that the Neon database and GitHub App are correctly configured, or that a scheduled ChatGPT agent can execute code. Those require authenticated and end-to-end tests after the owner completes setup.
