# Live Work Board (BR-062)

The owner-only `/work-board` page displays all repositories registered in Neon, current exclusive assignment, the authenticated scheduled agent's approved name, provider, work unit, lease freshness, real GitHub development timestamp, approved open work-unit count, roadmap sync state, and actual source freshness.

Lease states are deliberately conservative: no run = UNASSIGNED, live running lease = RUNNING, expired running lease = RECOVERING, and inconsistent records = UNKNOWN. RUNNING is only an operational lease classification, **not verified code progress**. A recovered runner may not start merely because a heartbeat expired. The server reads the authoritative database directly, with no fake sample data.

Priority repositories appear first, then ordinary repositories in oldest-development order. This display does not itself claim work. Assignment remains atomic in the Boardroom coordinator.

The page requires the signed owner session cookie and does not expose agent credentials or secret values. Both Owner Action Board and repository-priority editor link to it.
