# Private consolidated daily report

The authenticated `/reports` view gathers the last 24 hours of recorded GitHub commits and PR operations, pending owner actions, session outcomes, reported model charges and unsettled reservations, reconciliation failures, stale sources and owner priorities. Each GitHub receipt links to its repository evidence; PRs also link to current checks. Reported session completion is explicitly separate from accepted roadmap work.

Owner cards use their existing action IDs and become pending after one day and overdue after seven days. Reading a report creates no duplicate requests or notifications. Links jump to the exact private Owner Action card. Instructions, credential locations, provider messages and arbitrary audit payloads are excluded from the report projection.

The release section reports the revision serving the page and exact database readiness. It does not invent a deployment history. CI or live tests recorded outside the Boardroom gateway are not imported as agent work.

The view is private and read-only. BR-030 adds a durable daily notification batch for the same pending action set. One date-scoped idempotency key prevents repetitive duplicate alerts. The notification subject carries only the count; each body row contains age class, action type/status, affected-repository count, and a private one-click action reference. Titles, instructions, repository names, credential locations, provider results, and arbitrary audit data never enter the notification body.

Email delivery remains unconfigured; notification batches stay pending until an authorized provider adapter sends them. The batch ledger and audit receipt do not claim delivery. BR-068's broader operational digest and real scheduled delivery evidence remain separate.
