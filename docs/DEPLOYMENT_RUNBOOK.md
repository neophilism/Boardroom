# Boardroom deployment and first-use runbook (BR-077)

## Evidence checkpoint: October 13, 2026

- Source: `neophilism/Boardroom` is public. Runtime operational data and Owner Actions remain private.
- PR #42 is merged at `bd7973207ef2f88d4438bbcc56d752b1cd78102e`. Its exact pre-merge head passed CI, PostgreSQL concurrency, isolated Docker execution and security analysis.
- The dedicated Boardroom Neon database has the five historical migrations. Migration 0006 was successfully tested transactionally on an isolated child branch of that database, including ledger/hash and execution-table constraints. This supersedes the October 12 branch-authentication failure. A branch test alone is not evidence that production has migrated.
- The existing Render application address is https://boardroom-iamn.onrender.com. Verify the actual live commit and readiness after each release; historical deployment success is insufficient.
- No successful real scheduled-agent end-to-end acceptance is claimed. See [RELEASE_STATUS.md](RELEASE_STATUS.md).

## Required environment variables

- `DATABASE_URL`: Boardroom-only pooled Neon URL in the runtime secret manager.
- `DATABASE_URL_MIGRATIONS` or `DATABASE_URL_UNPOOLED`: optional direct migration URL; the migration runner converts a recognized Neon pooled hostname when only `DATABASE_URL` is present.
- `BOARDROOM_TOKEN_PEPPER`: independently generated secret, at least 32 characters.
- `BOARDROOM_OWNER_API_TOKEN`: owner-only high-entropy credential, at least 32 characters.
- `BOARDROOM_SESSION_SECRET`: separate high-entropy signing secret, at least 32 characters.
- `BOARDROOM_GITHUB_APP_ID`, `BOARDROOM_GITHUB_INSTALLATION_ID`, `BOARDROOM_GITHUB_APP_PRIVATE_KEY`, `BOARDROOM_GITHUB_OWNER`: scoped GitHub App integration.

Never put values in public GitHub, Coffee Corner, logs, PRs or chat. Use the existing provider secret-entry flows. Do not replace working credentials based only on a historical setup error.

## Render release sequence

1. Use the existing, owner-confirmed Boardroom workspace and service. Do not provision another service to bypass missing access.
2. Runtime: Node 22. Build: `npm ci --no-audit --no-fund && npm run build`. Start: `npm run start -- -p ${PORT:-10000}`.
3. Startup applies immutable migrations before exposing routes requiring the new tables. A mismatch in an applied migration hash stops startup.
4. `/api/health` is liveness only. Compare its revision to the deployed GitHub commit.
5. `/api/ready` must succeed with every required migration's exact source fingerprint. Required migration inventory is maintained in `db/migration-manifest.ts` and checked against the SQL files in CI.
6. Sign in privately, open `/system`, and use **Verify setup and import repositories**. A working GitHub token with no authorized repositories or insufficient permissions is not a completed setup.
7. Verify Work Board inventory and priority order; then register the approved agent identity under `/agents`. Supply the credential through the private connector/worker secret store, never its scheduled prompt.

## Migration safety

Historical SQL files are immutable. New migrations must pass disposable PostgreSQL testing and isolated Neon branch validation before production. Re-running the migration runner must find unchanged hashes and skip applied files. The October 13 test used the Neon transactional SQL tool on an isolated existing-schema branch, not a local migration CLI; its result is recorded in PR #42.

Migration 0006 SHA-256: `cbf5d2fbd4f77bbda847d10103f89fd59e5e28744ba5e8e5f15336ccdc4770b9`.

Do not directly manipulate live lease/agent rows to manufacture a passing acceptance result. Do not copy private database contents to public CI artifacts.

## Worker and production acceptance

Follow [HOSTED_WORKER_SETUP.md](HOSTED_WORKER_SETUP.md) and [EXECUTION_PROTOCOL.md](EXECUTION_PROTOCOL.md). Hosted execution and maintenance are disabled by default and need protected credentials plus explicit limits. Do not activate paid services or scheduled jobs merely to make a status light green.

The remaining acceptance requires a genuine authorized activation, an exclusive assignment, useful code, real PR/CI/review evidence, durable checkpoint/release, a second eligible unit, and safe recovery under interruption. Native ChatGPT scheduling and a hosted API worker are distinct routes; evidence for one must not be represented as proof of the other.
