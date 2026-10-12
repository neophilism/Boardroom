# Start one named unattended worker

The hosted runner is an explicit fallback; it is not a claim that a ChatGPT Work scheduled task is already connected. No paid model call occurs by default. The committed workflow runs hourly only after the owner enables it. Source, prompts, repository names, keys and test output are excluded from public workflow logs.

1. In the existing Boardroom Render service, correct the GitHub App key and use **Verify setup and import repositories** on `/system`.
2. On `/agents`, register one unused exact approved name. Store the one-time credential as `BOARDROOM_AGENT_TOKEN` in the GitHub **boardroom-worker** environment. Do not paste it into a task prompt or issue.
3. In that environment, set `BOARDROOM_AGENT_NAME` to the exact name, `BOARDROOM_BASE_URL` to the Boardroom HTTPS origin, `BOARDROOM_MODEL_PROVIDER` to `openai`, `anthropic` or `xai`, and `BOARDROOM_MODEL` to an explicitly selected model supporting function tools. Supply only that provider's key as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `XAI_API_KEY` in environment secrets.
4. Set a positive `BOARDROOM_MAX_COST_MICROUSD` (1,000,000 microdollars = $1), and the selected model's current `BOARDROOM_INPUT_USD_PER_MILLION` and `BOARDROOM_OUTPUT_USD_PER_MILLION`. Set `BOARDROOM_MAX_TOKENS` and optional session/tool-call limits. The runner reserves a conservative maximum before each call and yields at the configured cap. Validate prices and the provider's own spending limit before enabling.
5. Set `BOARDROOM_DAILY_COST_CAP_MICROUSD` on the Boardroom server. All hosted model requests reserve against this shared rolling 24-hour cap transactionally; a lost provider response retains the entire reservation rather than silently returning money to the cap. Usage is reported by the controlled runner, not independently obtained from provider billing.
6. On `/operations`, enable automatic merges only for intended repositories and specify their actual required CI names/review count. Default policies permit draft development and deny automatic merges. Actual GitHub merge requirements, CI and reviews still apply.
7. Set the repository variable `BOARDROOM_RUN_ENABLED=true` after the preceding steps. Run **Bounded hosted Boardroom agents** once with workflow_dispatch; examine the private Work Board, checkpoint, PR, CI and release. Keep the workflow disabled if any end-to-end prerequisite fails.

The runner checks out source through the assigned-repository gateway rather than an unrestricted GitHub token. Node dependency installation ignores lifecycle scripts. Actual checks run in short-lived unprivileged Docker containers with no network, no parent secrets, no Docker socket and limited CPU/memory/process count. Cancellation must verify container termination before releasing a lease. Symlink redirects from repository tests cannot redirect broker writes outside its workspace.

Current harness limits: Node package checks; 1,000 files; 30 MB total source; 1 MB per snapshot file; UTF-8 source edits up to 200 KB. A project outside those limits requires an authorized runtime that supports it, not an invented test success. This is not a production benchmark or security review.

To add named workers, launch the same broker instruction from distinct protected runtimes, each with its own registered credential and exact approved label. Their concurrent arrivals are coordinated by database leases. Do not share one credential across differently named workers. The checked-in initial workflow is intentionally one worker until the live trial passes; the database integration suite tests contention by 500 named activations.

## Existing ChatGPT/Claude/Grok scheduled tasks

The `/api/mcp` endpoint can be used only by a client/connector that supports protected bearer credentials and the supported MCP protocol. Every task uses the common approved instruction; the integration supplies identity separately. An endpoint URL or plain-text name is insufficient to authenticate. Never tell a user to place a token in a scheduled prompt. BR-004 still requires an actual scheduled ChatGPT Work invocation and code execution before that route is enabled or represented as working.
