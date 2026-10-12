# GitHub inventory and canonical plan reconciliation

Run `npm run sync:repositories` with server-only `BOARDROOM_GITHUB_APP_ID`, `BOARDROOM_GITHUB_INSTALLATION_ID`, and `BOARDROOM_GITHUB_APP_PRIVATE_KEY` provisioned as scoped secrets in the execution environment. The key must never be placed in scheduled prompts, GitHub issues, public source files, Coffee Corner, or the owner's browser.

Boardroom uses a dedicated GitHub App installation and its short-lived access tokens. The app must be installed on each repo that should participate; private repositories omitted from the installation are explicitly outside Boardroom's observed coverage. Minimal importer scopes: Metadata read, Contents read, Pull Requests read. Future fenced GitHub write gateway needs additional carefully scoped Contents/PR permissions and separate review.

On each run, the importer lists installed repos, fetches the single canonical `registry/roadmap.json` and actual GitHub PR state, validates approved work-unit counts, and upserts repositories, work units, lease rows, and source timestamps. Missing/malformed plans never produce fabricated tasks. Explicit PR links are used; otherwise an unambiguous exact stable-ID prefix in PR title can map to the unit. Ambiguous or unresolved PR links result in UNKNOWN, which the claim query excludes.

Owner priority is seeded to `neophilism/Boardroom` **only if no priority list exists**. The owner can later reorder it; a sync never overwrites their selected order. Other repo eligibility follows least-recently-updated GitHub activity as established by pushed_at and observed PR updated_at, not the DB's refresh clock.

This source code has no configured installation ID, token, Neon project, or scheduled reconciliation service yet. The CI tests verify normalized plan semantics; live GitHub App access and a migrated Neon branch are separate integration gates. For hundreds of repositories optimize polling through webhooks, ETags, pagination cursors and rate-limit/backoff controls (BR-057/058).
