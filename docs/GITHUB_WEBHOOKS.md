# GitHub event ingestion and ordering (BR-057)

## Transport and scope

Configure the GitHub App webhook to POST `application/json` to
`/api/v1/github/webhook`. The existing server-side settings are
`BOARDROOM_GITHUB_WEBHOOK_SECRET` (at least 32 characters) and
`BOARDROOM_GITHUB_INSTALLATION_ID` (this owner's installation). Configure secret
values through the platform secret store; never send them in chat, repository
files, event messages or logs. This change creates no App, paid resource or
scheduler and changes no installation permission itself.

The handler stops body reading at 1,000,000 bytes and checks HMAC-SHA256 against
the **exact bytes**, before UTF-8/JSON decoding or opening a DB connection.
Whitespace, Unicode and byte-order marks cannot be normalized before signature
verification. Compressed/non-JSON requests are rejected. The App installation
must match the configured installation; an authenticated ping may omit its
installation, but cannot change state or create work. Every response is no-store.

Supported notifications: push, pull_request, workflow_run, check_run, check_suite,
repository, installation_repositories and ping. Valid signed but unconsumed
event types are acknowledged without creating a job. Invalid headers/JSON/IDs
return 400, invalid signatures 401, foreign installation 403, delivery-ID
conflicts 409, oversized bodies 413, unsupported encoding 415, and unavailable
configuration/database 503. Failures never echo request bodies or remote errors.

## Durable deduplication and privacy

Receipt insertion and reconciliation outbox insertion are one transaction.
A queue failure rolls both back, so redelivery is not mistakenly acknowledged
as already handled. A strict, case-normalized delivery GUID identifies the
receipt; a unique SHA-256 body fingerprint also coalesces identical signed-body
replays under a different header ID. Reusing an ID/body with conflicting event,
repository or installation metadata fails closed. Pre-migration receipt IDs
remain deduplicated without pretending their original body was fingerprinted.

Only repository/installation IDs, event type, digest and receipt timestamps are
retained, not raw payloads, source code, PR/commit descriptions, action text,
sender identity or credentials. Receipts remain private control-plane records.
Unknown repository IDs are not imported from a webhook. Installation repository
changes queue fresh reads for affected **registered** IDs plus an App inventory
refresh for additions. Removed-access claims never directly disable a project:
the actual App read must independently confirm availability or fail closed.

## Ordering: notifications are not authoritative snapshots

Payload claims about branches, PR state, merges, archived flags and event times
never set verified project state or source freshness. The existing dispatcher
performs installation-scoped GitHub reads. A delayed `opened` event received
after a merge therefore re-reads the current PR rather than reopening it from
the payload. A genuinely new open follow-up observed on GitHub can still revoke
completion under the existing roadmap contract.

Each refresh reserves a monotonically increasing repository observation version
**before** its network reads. Repository metadata is re-read by immutable numeric
ID, including after a rename; an earlier inventory snapshot is not published.
Publication takes a short row lock and succeeds only if its version is still
current. A newer attempt supersedes both the data and failure of an older one.
An older, slower response cannot overwrite a newer verified plan or revoke its
approval; a current verification failure holds work without overwriting known
repository identity/activity with stale fallback metadata. Owner-enabled flags
are never silently changed. No DB lock is held during network calls.

The guarded merge path reserves another observation version when reconciling a
verified merge, invalidating refreshes started before that authoritative state
change. This adds no merge permission and preserves all current-head check,
review and owner/self-update gates. A superseded read does not assert success or
advance source-observed timestamps. Latest reads may still fail or GitHub may
change during requests: this does not promise an atomic GitHub-wide snapshot or
instant delivery. Periodic reconciliation/retry policy remains separate work.

## Migration and verification

Migration `0014_github_delivery_fencing.sql` adds nullable receipt fingerprints
and installation IDs, a partial digest uniqueness index and observation versions.
The version table deliberately has no repository FK: authorized inventory import
must reserve a version before a new repository exists locally. Applied migration
SQL is immutable. Deploy the additive migration before this application code.
Retain separately pending 0012 and 0013 and all fingerprints when reconciling
parallel PRs; do not replace their manifest entries with 0014.

Unit/HTTP-handler fixtures cover byte-exact signatures, scope, stream bounds,
malformed input, private error handling and minimal storage. Real PostgreSQL CI
fixtures use an isolated randomized schema and the exact full migration manifest
to exercise concurrent replay, ID conflicts, queue rollback, installation-change
jobs and overlapping success/failure/merge observations. Controlled GitHub read
fixtures are not live App delivery evidence. Operational acceptance still needs
an authorized deployment and actual GitHub delivery/redelivery evidence; passing
source tests alone does not establish that the live webhook is configured.

## Primary protocol references

- [GitHub: validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [GitHub: webhook best practices and delivery identifiers](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [GitHub: webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
