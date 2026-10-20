# Boardroom: three independent $0 hosting targets

**Scope:** Redeploy the existing working Boardroom application, not redesign or
recreate it. Current Neon production data, agent credentials, leases, GitHub App
and OAuth tables are preserved. Engine Room is out of scope.

Render suspended service `boardroom` on October 19, 2026 after the 750
free instance hours were exhausted. The database was separately verified intact
on October 20. This repository already has the working source, migrations,
tests and image publishing workflow.

## Hosts to provision and test (none claimed live without evidence)

| Host | Cost guard | Entry method | Typical role |
|---|---|---|---|
| Netlify Free | $0, 300 monthly credits, hard limit; quota can pause the site | GitHub integration, Next.js/OpenNext adapter, `netlify.toml` | Serverless primary candidate |
| Deno Deploy Free (2026 platform) | $0, free request/CPU/memory limits; monitor limits | GitHub integration, auto-detected Next.js 16 | Second serverless candidate |
| Existing Oracle Always Free E2.1.Micro VM | $0 while the VM remains within Oracle Always Free entitlement | Prebuilt GHCR Docker image + `ops/hosting/oracle/compose.yaml` | Persistent server/standby candidate |

Deno Deploy: use **console.deno.com**, not the retired Deploy Classic.
Netlify: https://app.netlify.com/start. Oracle: existing VM (do not
create a new paid instance). Koyeb and Northflank also offer free developer
tiers but impose payment-method checks and/or important restrictions; they are
not required for the three-target plan. Vercel Hobby is for non-commercial
personal use only and is not assumed suitable for Boardroom business operations.

## All three use the SAME application and production data

- Source: `neophilism/Boardroom` with the same release commit and migration
  ledger. Retain the existing Boardroom Neon `DATABASE_URL`; do not copy data
  into provider-managed databases or create new production schemas.
- Runtime secrets: `BOARDROOM_TOKEN_PEPPER`,
  `BOARDROOM_OWNER_API_TOKEN`, `BOARDROOM_SESSION_SECRET`, GitHub App and
  webhook credentials. Copy **values** from Render's private provider settings
  directly to each host's private secret manager (or a root-owned VM .env).
  Do not paste into public GitHub or ChatGPT.
- `BOARDROOM_PUBLIC_ORIGIN` must be the exact current host's HTTPS origin.
  Set `BOARDROOM_OAUTH_ENABLED=false` on preliminary standbys.
- `BOARDROOM_RELEASE_SHA` may be set to the exact deployed 40-character SHA
  on Deno Deploy. Netlify embeds `COMMIT_REF` at build, and Oracle embeds the
  SHA in its verified Docker image. An incorrect or stale SHA fails verification.
- Startup migrations: Oracle Docker container runs the current migration
  launcher. Netlify and Deno serverless route handlers do **not** run the
  Node `npm start` process. As of October 20, all 16 Boardroom production
  migrations through 0017 are recorded in Neon. Future schema changes must
  run through the existing reviewed migration workflow **once** before switching
  serverless releases.
- Only one host receives the real GitHub webhooks, scheduled maintenance
  requests, OAuth/MCP agent connections and production writes at a time.
  The extra host deployments should first be tested with outbound automations
  disabled, then disabled/paused until needed.

## Netlify deployment

1. Import `neophilism/Boardroom` into Netlify Free; use
   `production/boardroom-netlify` as the production branch. It points to
   a vetted commit and does not follow every `main` merge.
2. The root `netlify.toml` directs `npm run build` after securely embedding
   Netlify's `COMMIT_REF`. Netlify auto-enables its official Next.js SSR
   adapter. Do not configure a static site or SPA fallback rewrite.
3. Store the existing runtime env vars with Functions + Builds scopes and the
   public origin `https://<site>.netlify.app`, then deploy. Do not use the
   `NEXT_PUBLIC_` prefix for private values.
4. Confirm /api/health, /api/ready, private-owner redirect, and anonymous
   denial via `hosting-verify.yml`. Monitor monthly free credits.

## Deno Deploy deployment

1. Open https://console.deno.com and create a Free application from GitHub.
   Select `neophilism/Boardroom`, release branch
   `production/boardroom-deno`, Next.js framework.
2. Let Deno Deploy automatically build its standalone Next.js App Router app.
   Set production-only secrets and `BOARDROOM_PUBLIC_ORIGIN` to the resulting
   `https://<app>.<org>.deno.net` origin; use actual returned domain.
   Set `BOARDROOM_RELEASE_SHA` to the release branch's exact Git SHA.
   Do not enable untrusted preview branches with production credentials.
3. Verify the production URL using the existing `hosting-verify.yml`.
   Node compatibility is implemented by Deno; verify live PostgreSQL,
   OAuth discovery and all Next.js request handlers rather than assuming
   build success proves full compatibility.

## Existing Oracle VM deployment

1. Use the existing E2.1.Micro (no new account, instance or upgrade).
   Configure Docker Engine with Compose on that machine, DNS pointing to the
   VM's public IP, and inbound TCP 80/443 (OCI network security + VM firewall).
2. Copy `ops/hosting/oracle/` into a private VM directory. Copy
   `env.example` to `.env` on the VM and use `chmod 600 .env`;
   fill only through a protected shell/session. Set `BOARDROOM_IMAGE` to the
   verified `ghcr.io/neophilism/boardroom:sha-<40-char Git SHA>` published
   by `.github/workflows/container-release.yml`. If the GHCR package is
   private, authorize the VM with a scoped package-read credential.
3. Caddy serves HTTPS; the Next.js process listens only behind the internal
   reverse proxy on port 10000. Start using
   `sh ops/hosting/oracle/deploy.sh`. The VM's 1 GB RAM is tight; the
   container's memory and Node heap are explicitly bounded. Actual startup
   capacity must be tested. Do not build from source on this small VM.
4. Check health and readiness via `hosting-verify.yml`. Never mark the
   host as ready merely because Docker reports a running process.

## Turn on exactly one production host

1. Deploy/test the candidates, preferably with production automations
   disabled. One candidate must pass the strict public smoke for an exact
   commit and manual owner login/GitHub App/agent checks.
2. Set GitHub Actions repo variable `BOARDROOM_PUBLIC_URL` to that exact HTTPS
   origin, retarget the GitHub App webhook securely, and enable OAuth/MCP for
   the selected host only. If no stable domain is owned, agent OAuth grants
   scoped to the old resource origin will require fresh user consent.
3. Disable deployments on the standby sites, leave their provider projects and
   build configurations intact, and stop all standby services that incur
   compute. Keep the vetted release branches and published GHCR image.
   On Render, leave the suspended service untouched until its free quota resets;
   do not pay to reactivate it.
4. In a failure: stop/disable old maintenance + webhooks, start the prepared
   alternative, supply its existing runtime secrets, verify exact readiness,
   repoint `BOARDROOM_PUBLIC_URL` and webhook, reconnect agents as required.
   **Never run two production maintenance schedulers concurrently.**

## Current reality

A source code branch is not a deployed application. This work is complete only
when independent provider apps are created, strict HTTPS smoke and owner/agent
tests pass, and exactly one host remains enabled. GitHub/Render/Neon
connections cannot create external Netlify, Deno Deploy or Oracle VM services
without the corresponding hosting access. Record real URLs and verification
evidence once they exist; do not invent them.
