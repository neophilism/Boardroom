# Boardroom Neon database

Boardroom's persistent control-plane schema is defined by numbered additive migrations in `db/migrations`.

Apply on a dedicated isolated Neon branch first: `DATABASE_URL_MIGRATIONS=... npm run migrate`. Use a dedicated migration role in production; normal application traffic should use a least-privilege pooled `DATABASE_URL`.

The migration runner acquires a Postgres advisory lock, checks SQL file hashes, applies each new migration in a transaction, and refuses historical file modification. Never commit connection strings or credentials.

**Not yet applied:** This PR establishes the schema and runner in source control; provisioning a Neon project, applying migrations, runtime token authorization, and live integration testing are separate acceptance steps.

**Why the lease row persists:** `repository_leases.generation` is monotonically incremented on every new assignment, even after release. Superseded sessions cannot take ownership again merely because their old heartbeat expires. Only a verified stop or write isolation permits recovery.

**Owner action privacy:** `owner_actions` contains instructions/target names, not secret values. Secure storage and owner authentication are mandatory before exposing these tables through routes.

**Recommended smoke tests:** migrate empty database; migrate twice (no-op); edit applied SQL and confirm checksum failure; verify duplicate lease attempts and partial-unique assignment constraints inside two concurrent transactions.
