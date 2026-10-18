# Agent Intelligence & Usage Observatory

Owner-only, manual-refresh view at `/observatory` for the existing Boardroom system. Access requires the same signed owner session as `/operations`. **No paid model call**, new paid cloud service, autonomous ChatGPT schedule, schema migration or provider key is required for this feature.

## Measurement provenance, not invented credits

- **Observed:** agent arrivals/runs/last seen, current RUNNING sessions, recovery holds, outbox states, owner-action counts, maintenance tick time, verification of server-origin GitHub merge events.
- **Hosted model reported:** input/output tokens, calculated USD using operator-configured provider token rates, and separate outstanding maximum reservations. A reported call does not mean an independently reconciled invoice.
- **Unavailable:** native ChatGPT Work credit balances, per-agent native Work billings, account quotas, private model choice/reasoning effort and scheduled tasks that never reached the Boardroom server. *Unavailable* must not be shown as zero.
- Zero dollars in the reported hosted-API column does not imply the agent used zero native ChatGPT credits. Cache tiers, reasoning tokens, provider-side tools, surcharges and invoicing may differ from estimates.
- A merged PR is an independently checked milestone, not proof that a deployed application works. A model with hard tasks may appear worse than one working on trivial tasks; do not auto-select models by simple merges per dollar.
- Daily graph uses UTC calendar days; all rolling comparisons use trailing windows. No raw prompts, tokens, credentials, session bodies, personal email or billing identifiers go to the browser.
- Reported hosted dollar totals exclude costs from GitHub Actions, hosting, database, storage, external tools and unmetered native Work sessions.
- Reservations are **separate** possible financial exposure for unconfirmed provider calls and may remain after provider timeouts. Do not count these as confirmed charges. Budget enforcement must remain conservative on uncertain paid calls.

## Cheap deterministic routine operations

The existing `.github/workflows/maintenance.yml` runs every 10 minutes on GitHub Actions and makes an authenticated call to `/api/v1/internal/tick` (credentials or OIDC). The backend performs the watchdog, recovery-hold creation, bounded repository inventory scan and transactional outbox delivery on Render/Neon. Existing GitHub Actions CI runs test jobs. None of these operations needs a model or spends ChatGPT Work credits.

This PR surfaces maintenance/outbox health and usage alongside GitHub work evidence instead of introducing a model-powered monitor or a polling loop. The current backend's merge tool still enforces the exact commit, CI, lease and approval rules. Deterministic auto-merge reconciliation is being developed separately in the existing workstream and **must not** be simulated by an unrestricted GitHub Actions token. Never bypass required branch review/rules for the Boardroom control plane.

## Validation, runbook and safety

- Click **Manual refresh** for a current server snapshot. The view intentionally never streams/polls every agent.
- Inspect an agent to compare rolling 24h/7d/30d hosted values, its current repository, completed/failed/blocked runs, and verified merges/merge denials.
- Verify an unknown-provider or native ChatGPT robot displays **Unavailable** in the native credits column, even with valid Boardroom sessions. An unmetered hosted column displays **Not measured**, not a claimed cost of $0.
- A paused or offline GitHub Actions scheduler should show a stale last maintenance tick, not a green status. Outbox failures and recovery holds are counts, not automatic reassignment permission.
- Review the existing CI gates and live deployment separately. A merge or code change does not mean a production release.
- This first release intentionally avoids enabling paid providers or changing the canonical roadmap count.

Next: `docs/API_AGENT_SCALE_PLAN.md` defines the gated, dependency-ordered API agents and fleet-scale development plan.
