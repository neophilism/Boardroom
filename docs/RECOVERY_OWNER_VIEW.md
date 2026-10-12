# BR-053: Owner recovery review

The private `/recovery` page shows genuine PostgreSQL records for repository leases whose sessions are RECOVERING, UNKNOWN, or RUNNING with an expired lease. It includes registered agent display name, provider, run ID, work unit, generation, timestamps and any open matching Owner Action.

This is intentionally read-only. The presence of a stale timestamp does not authorize a takeover. Safe reallocation remains disabled pending verified process isolation and fencing. The watchdog remains unscheduled until a separately protected scheduler/token is configured.

The view is owner-session-gated; it does not expose names, run identifiers, or operational data on public setup pages.
