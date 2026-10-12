# Owner-controlled Boardroom repository priorities (BR-012)

The owner maintains an explicit ordered list of high-priority GitHub repositories. Whenever an authenticated temporary agent asks for work, Boardroom selects the first available and eligible priority repository before any ordinary project. Once all priority repositories are occupied or otherwise ineligible, the oldest verified GitHub development timestamp wins among other eligible repositories. Leased repositories are excluded; the assignment happens atomically in PostgreSQL.

## Private API

`GET /api/v1/owner/priorities` — returns the current ordered list, live source names, and last real development timestamps.

`PUT /api/v1/owner/priorities` with JSON body `{"repositoryIds":["1415596507","1409253829"]}` — replaces the ordered list in one transaction. Provide numeric GitHub repository IDs as **decimal strings**, preserving values beyond JavaScript's safe integer range. Empty array deliberately clears the priority list. Duplicate, archived, disabled, or nonexistent repositories are rejected.

Both endpoints require a valid owner bearer API token, and never expose its value. The replacement service validates all inputs, serializes concurrent owner updates using a PostgreSQL advisory transaction lock, updates positions atomically, and records an audit event.

UI editing of this order is a separate work unit (BR-062). Agents cannot alter the owner's priority list.
