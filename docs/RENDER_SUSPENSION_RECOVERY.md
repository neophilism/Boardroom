# Boardroom recovery from Render free-tier suspension (October 20, 2026)

## Evidence and nonnegotiable constraints

- Boardroom's Render web service `srv-db6jnrlg1s2s739jt9ug` is suspended by
  `Free Tier Usage Exceeded` on October 19, 2026. Rebuilding it on the same
  exhausted workspace does not bring it online. Do not upgrade or create billable
  services without explicit owner authorization.
- The existing production **Boardroom** Neon project and branch are the source
  of truth. On October 20 a read-only audit observed all sixteen migrations,
  through `0017_continuous_work_sessions.sql`. Never create an empty replacement
  database, reset leases, or export owner data to CI.
- Boardroom is an authenticated database-backed Next.js 16 application. A static
  website or redirect is **not** a restored Boardroom.
- A Netlify Free plan currently gives 300 monthly credits with a hard cutoff.
  It does **not** mean unlimited uptime. Its SSR/API functionality uses functions.
  This is a short-term recovery path, not a claim of operational equivalence to
  the original always-on server.

## Deploy the real application on Netlify Free

1. Connect the existing public `neophilism/Boardroom` GitHub repository in
   Netlify. Use the **`production/boardroom-netlify`** branch as the
   production branch, *not* actively changing `main`. The branch is a tested
   release pointer; advancing it manually is how new work goes live without
   consuming 15 credits on every development merge. Disable unneeded previews
   and other automatic deployments. Never enable a paid plan or recharge.
2. Netlify reads the root `netlify.toml`: Node 22, install from the lockfile,
   run `scripts/prepare-netlify-build.mjs` then `next build`, and publish
   `.next`. Let Netlify's OpenNext adapter run SSR, App Router handlers and
   middleware. Do not install an old adapter or switch Next.js to `output: export`.
3. Copy existing credential **values** from Render's secure settings into
   Netlify's **production-only** server-side environment (Functions and Builds
   scopes as applicable), never into a Git commit, screenshot, PR, build log,
   deploy preview or ChatGPT message:

   - `DATABASE_URL`: the existing Boardroom Neon pooled connection string.
   - `BOARDROOM_TOKEN_PEPPER`, `BOARDROOM_OWNER_API_TOKEN`,
     `BOARDROOM_SESSION_SECRET`: preserve their existing independent secrets.
   - `BOARDROOM_PUBLIC_ORIGIN`: exact final HTTPS site origin, with no path
     or trailing route, e.g. `https://<your-site>.netlify.app`.
   - `BOARDROOM_GITHUB_APP_ID`, `BOARDROOM_GITHUB_INSTALLATION_ID`,
     `BOARDROOM_GITHUB_APP_PRIVATE_KEY`, `BOARDROOM_GITHUB_OWNER` for actual
     repository operations. Preserve PEM multiline structure.
   - `BOARDROOM_OAUTH_ENABLED=true` only after owner/agent OAuth is tested.
   - Existing signing/webhook secrets and cost limits where required by the
     enabled integrations. Default unattended paid model usage to OFF.

   Do not set `NEXT_PUBLIC_` on private values. Netlify environment changes
   require a new deployment to reach published functions.
4. The prebuild step rejects a missing/invalid provider Git SHA and embeds the
   release revision in the Next.js server bundle. `/api/health` is a liveness
   check only. `/api/ready` must verify the existing live database's
   configuration and migration fingerprints.
5. Make a credential-free HTTP verification of `/api/health`, `/api/ready`,
   `/setup`, `/login`, OAuth resource discovery when enabled, and anonymous
   DENIAL from `/owner-actions`, `/agents`, `/system`,
   `/api/v1/owner/agents` and `/api/v1/internal/tick`. The smoke script accepts
   `BOARDROOM_BASE_URL=https://<your-site>.netlify.app` and
   `BOARDROOM_EXPECTED_REVISION=<tested-40-char-Git-SHA>`.
   Authenticated owner setup, GitHub App repository import, webhook delivery,
   named-agent activity, and a real second task are **separate** checks.
6. Update the repo's GitHub Actions variable `BOARDROOM_PUBLIC_URL` to the
   same exact HTTPS origin. This redirects the existing bounded maintenance
   workflow and worker origin away from suspended Render. The existing GitHub
   OIDC maintenance authentication pins the workflow and validates the **new**
   audience using `BOARDROOM_PUBLIC_ORIGIN`. Do not loosen token validation.
   Retarget GitHub App webhook(s) through the provider's secure settings.
7. Old OAuth tokens were issued for the prior Render resource origin and must
   not work against the new origin. Reconnect/re-consent existing named agents
   through the new Boardroom URL. Browser owner sessions require fresh login.
   Never rewrite OAuth grants in the database merely to simulate migration.
8. Track free credits and actual function execution duration; a serverless
   maintenance tick may exceed execution limits. Treat a timeout as an outage,
   reduce work per bounded tick safely, or use an authorized persistent host.
   Never report a passing health route as agent-coordination acceptance.

## Fallback persistent host

The owner's existing Oracle Always Free E2.1.Micro VM may be used **only** when
its SSH/deployment access is actually available. It has limited CPU and 1 GB RAM,
so build the application/container in independent CI rather than on the VM.
The published Boardroom Dockerfile already supports an immutable GHCR image
from the repository's `container-release.yml`. Reuse the existing Neon database
and secrets through the VM's private runtime settings. No SSH credentials or
ready-to-run deployment integration have been verified yet; this fallback is
not deployed.

## Recovery status semantics

- `source_prepared`: deploy config and smoke tooling checked in.
- `hosting_connected`: provider is connected to the designated Git branch.
- `running`: external URL returns the deployed app and readiness 200.
- `operational`: owner login, GitHub App, OAuth/MCP, background tick,
  and actual authenticated agent task flow are checked live.

**Never mark an earlier step as completion of the next one.**
