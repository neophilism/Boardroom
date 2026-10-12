# Boardroom deployment and first-use runbook (BR-077 foundation)

## Verified status, October 12 2026
- GitHub source: `neophilism/Boardroom`, public repository; operational Boardroom UI remains owner-authenticated.
- Neon: a dedicated **Boardroom** project has been created in `aws-us-east-2`. The five SQL migrations were applied transactionally and the migration ledger verified. Do not paste the connection string into source control.
- Render: the existing `boardroom` web service is deployed at https://boardroom-iamn.onrender.com. Process/readiness checks do not establish autonomous execution.
- ChatGPT hourly scheduled-task integration: no successful live end-to-end proof yet.

## Required environment variables

- `DATABASE_URL`: Boardroom-only pooled Neon database URL, held solely by the runtime secret manager.
- `BOARDROOM_TOKEN_PEPPER`: randomly generated secret (>= 32 characters), separate from all other credentials.
- `BOARDROOM_OWNER_API_TOKEN`: owner-only high-entropy credential (>= 32 characters); only the owner receives this credential through an approved secure channel.
- `BOARDROOM_SESSION_SECRET`: independent high-entropy signing key (>= 32 characters).
- `BOARDROOM_GITHUB_APP_ID`, `BOARDROOM_GITHUB_INSTALLATION_ID`, `BOARDROOM_GITHUB_APP_PRIVATE_KEY`, `BOARDROOM_GITHUB_OWNER`: GitHub App deployment and inventory integration. Use repo-specific least privilege.

Do not expose values in docs, Coffee Corner, logs, user-facing check responses, PRs, or chats.

## Render configuration

- Use the approved Render workspace and a service on a supported plan.
- Repository: `https://github.com/neophilism/Boardroom`
- Runtime: Node 22
- Build command: `npm ci --no-audit --no-fund && npm run build`
- Start command: `npm run start -- -p ${PORT:-10000}`
- Health endpoint: `/api/health` indicates process liveness, not operational readiness.
- Readiness endpoint: `/api/ready` returns 503 when required secrets, DB access, or schema migrations are absent.
- For real workloads, inspect `/api/ready`, then verify private owner login, repository sync, work claims, and Coffee Corner; HTTP 200 alone is not end-to-end validation.
- Never put the owner API token in a public GitHub Actions secret or client-side JavaScript.

## Existing DB schema

The migration runner checks hashes in `schema_migrations` and refuses modified historical SQL. Always review new migrations before running on any nonempty database. The initial five migrations were verified on the existing deployment. Migration 0006 must pass isolated PostgreSQL and Neon branch validation before deploying the execution batch. No named agent execution is claimed by code tests.

## Production acceptance still pending

1. Owner-only access and secure credentials are deployed and verified.
2. GitHub App installation credentials are present; inventory sync imports genuine repos and approved plans.
3. At least one real scheduled ChatGPT activation authenticates to Boardroom and is authorized to do useful repository work, or the documented alternative runtime is demonstrated.
4. Repeated schedules do not duplicate active agent sessions.
5. One actual fenced repository claim, code change, CI-verified PR, checkpoint, and release are demonstrated end to end.
6. Watchdog and crash recovery tested; cost and security gates reviewed.

Never say Boardroom is autonomous or production ready until these tests pass.

## October 12 execution batch

See `EXECUTION_PROTOCOL.md` and `HOSTED_WORKER_SETUP.md`. Local checks and CI validate code, including a 500-arrival PostgreSQL contention test; they do not satisfy live production gates. Neon branch creation returned an authentication error during this session, so branch migration validation remains blocked. Existing GitHub App setup previously reported an invalid signing key; PR #41 fixes valid PEM copy formats but cannot reconstruct a missing or truncated key. The hosted and maintenance workflows are disabled until protected credentials and limits are configured.
