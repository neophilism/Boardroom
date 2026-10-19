# Stale-claim recovery (BR-017/020 follow-up)

An admitted native session reported `SESSION_CONFLICT: Repository state is stale;
retry after authoritative GitHub synchronization` and then ended without work.
Refreshing a candidate outside the claim transaction cannot guarantee that the
same repository remains available: another run may lease it, or reconciliation
may remove its last eligible unit. A four-candidate refresh bound also cannot
guarantee that the next portfolio candidate has been synchronized.

Claim now selects only freshly reconciled repositories inside the lease
transaction. A failed refresh skips that project within the bounded preflight
and records a secret-free diagnostic; healthy, fresh portfolio work remains
assignable. Priority still orders the eligible fresh candidates. Stale work is
never authorized, and existing leases are never taken over.

When eligible work remains but none is fresh, MCP and HTTP return the recoverable
`ASSIGNMENT_REFRESH_PENDING` code, not `IDLE` or a generic lease conflict. The run
remains admitted with no new lease. Retry the same run with bounded backoff;
never call arrival again to evade admission. A sustained outage remains a
truthful capability blocker and must preserve the next scheduled activation.

Regression coverage includes a failing priority project with a healthy fallback,
a second run acquiring the freshly synchronized candidate before claim, and four
merged candidates consuming the refresh bound before a fifth stale project.
These cases run against the real PostgreSQL integration fixture. Existing lease,
generation, prerequisite, source freshness and spending controls remain enforced.
