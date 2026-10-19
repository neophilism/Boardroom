# Agent-to-project status (private, manual refresh)

Owner-only **/agent-status** is the human-friendly place to see all current and planned robot identities. It shows account email when registered, or a placeholder group number for the four future accounts; registration does not happen merely by reserving a name.

The page performs a database read when opened or when **Refresh assignments** is clicked. There is **no timer, background refresh, scheduled job, webhook subscription or AI call**. Reading the status does not create a lease, refresh a heartbeat or wake a robot.

The displayed current project comes only from an unreleased `work_assignments` record connected to the named credential's run. Its name comes from `repositories`. A matching run/generation in `repository_leases`, live expiry and heartbeat are required for a `RUNNING` classification. Expired leases are `RECOVERING`; mismatched or incomplete data is `UNKNOWN`, not treated as a free project. Last released projects are clearly marked **Previous** rather than current. No work is invented when no assignment exists.

Future names are reserved in Neon `agent_name_reservations`, mapped to account slot 2–5. These reservations do not contain OAuth grants or credentials; the owner enters the actual provider-account email in /agents while registering each robot. The real account emails must not be checked into source, public CI artifacts or scheduled prompts.

This is coordination evidence, not proof that an agent is actively producing code. Use Work Board and GitHub PR/check evidence to verify outcomes.
