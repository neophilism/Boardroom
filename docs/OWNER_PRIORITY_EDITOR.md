# Boardroom priority editor (BR-062)

The private `/priorities` page is available to an authenticated owner alongside `/owner-actions`. It displays registered active repositories, lets the owner add/remove/reorder high-priority repositories, and saves the entire sequence in one authorized transaction.

The editor does not assign work itself. The existing database claim query uses `repository_priority.position` and will select the first eligible unlocked priority repo. If all priorities are occupied or otherwise ineligible, ordinary repo selection falls back to oldest verified GitHub development timestamp. UI display of timestamps does not change selection source data.

The browser uses a same-origin, HttpOnly signed owner session cookie and an origin-checked PUT request; no owner API bearer token is embedded in frontend JavaScript. CLI users may still use the private bearer-auth API. Repositories not imported into Neon are not fabricated in the interface.
