# BR-082 — $0 API gate and emergency stop

No paid API request is permitted solely because a hosted runner is scheduled or has a provider key. All **three** independent requirements must be true before issuing a model request:

1. GitHub Actions worker requires `BOARDROOM_RUN_ENABLED=true` **and** `BOARDROOM_API_SPENDING_ENABLED=true` to start a paid-worker job. The Node configuration repeats these checks; missing/false flags return no runnable configuration without reading keys.
2. The Boardroom backend also requires `BOARDROOM_API_SPENDING_ENABLED=true`, which is **false by default**. Missing flag returns structured `API_DISABLED` without opening the database or reserving any funds.
3. A Postgres transaction must observe `execution_controls.api_spending_enabled=true` (migration 0015 defaults **false**) while holding a SHARE lock, as well as an explicit positive daily dollar cap and safe remaining reservation headroom.

There is **no enabling API** in BR-082. A future owner-approved funded onboarding flow (BR-087/096) must first implement explicit dollar spending authority and reconcile provider invoices, then expose a documented audited enable operation. Nothing in this PR funds or activates providers. Default after deployment remains **$0**.

The owner-only existing `/operations` page has an emergency stop for paid provider reservations. It writes `api_spending_enabled=false` in a transaction and audits the command. It does not stop native ChatGPT Work tasks or change the owner repository execution pause. Once a stop commits, subsequent reservations fail closed. Calls already sent to a provider may still complete and bill; settlement events remain accepted to reconcile them.

Budget errors use safe code `API_DISABLED`; hosted agents yield/checkpoint without repeated owner-spending-request prompts. Do not retry the call, silently reenable the flag, or insert credentials in a public repository. The global emergency stop is independent of provider rate limit, per-agent metering, and future tenant caps.

Verify GitHub CI, real PostgreSQL migration and concurrency tests. New migration 0015 depends only on the existing execution_controls singleton, not on separate in-flight migration 0012 or 0013. Existing named ChatGPT sessions remain unaffected.
