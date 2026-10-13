# Private consolidated daily report

The authenticated `/reports` view gathers the last 24 hours of recorded GitHub commits and PR operations, pending owner actions, session outcomes, reported model charges and unsettled reservations, reconciliation failures, stale sources and owner priorities. Each GitHub receipt links to its repository evidence; PRs also link to current checks. Reported session completion is explicitly separate from accepted roadmap work.

Owner cards use their existing action IDs and become pending after one day and overdue after seven days. Reading a report creates no duplicate requests or notifications. Links jump to the exact private Owner Action card. Instructions, credential locations, provider messages and arbitrary audit payloads are excluded from the report projection.

The release section reports the revision serving the page and exact database readiness. It does not invent a deployment history. CI or live tests recorded outside the Boardroom gateway are not imported as agent work.

The view is private and read-only. Email delivery remains unconfigured; this change does not send messages or claim notification-provider acceptance. Full BR-030/068 acceptance still includes the authorized notification delivery route and real scheduled-run evidence.
