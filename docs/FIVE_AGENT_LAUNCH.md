# Launch five named scheduled workers

Use the existing Boardroom service. The private `/launch` screen shows native identity registrations, unexpired OAuth credentials, arrival/assignment counts, imported plans and automatic-merge policy coverage. It provides one copyable instruction from `src/domain/scheduled-instruction.ts`; the same text is reproduced in [SCHEDULED_AGENT_PROTOCOL.md](SCHEDULED_AGENT_PROTOCOL.md).

## Owner connection steps

1. Sign into Boardroom using its existing owner credential. On `/system`, verify the GitHub App and repository import. Never share the credential in chat or public source.
2. On `/agents`, register five distinct exact roster names with provider **ChatGPT** and connection method **Native ChatGPT OAuth**. No bearer value needs copying. The returned identity does not imply OAuth consent or a working schedule.
3. In each intended ChatGPT account or named connection, add the custom MCP server `https://boardroom-iamn.onrender.com/api/mcp`, choose OAuth, and authorize the corresponding registered name. See [native setup](NATIVE_CHATGPT_SETUP.md). Confirm `boardroom_profile` returns that exact name before starting work. Select the intended connection in each task; do not assume one shared default connection will identify five agents differently.
4. On `/operations`, configure automatic merges for the intended repositories with their actual required check names. Preserve GitHub rules, current-head CI and exact-commit control-plane approval requirements. The initial default disables merging; an agent name or a schedule cannot change it. Resume execution if paused.
5. Run the shared instruction manually once. Verify the real assignment, useful commit, mapped PR, current-head checks, checkpoint and release. Record references privately. Then verify one genuine scheduled activation, advancement through a second eligible unit and interruption recovery. Do not call mocked or manual activity a scheduled trial.
6. After that passes, create five hourly schedules using the identical shared instruction. Stagger starts at :00, :12, :24, :36 and :48 when the scheduler supports explicit start times. Busy identities end without duplicate work. Five hourly triggers improve coverage; actual session durations, provider quotas, account runtime and available repositories determine throughput. They do not guarantee continuous compute.
7. Review `/reports` for the last 24 hours of observed GitHub receipts and `/owner-actions` for owner-only prerequisites. Distinguish a completed activation from accepted code, and accepted code from deployed functionality.

## Maintenance and recovery

The existing deterministic maintenance workflow handles stale-session holds, inventory refresh and outbox dispatch. After deploying the OIDC maintenance release, set `BOARDROOM_GITHUB_MAINTENANCE_OIDC_ENABLED=true` on the existing Render service. Its ten-minute GitHub workflow obtains a short-lived signed identity assertion; no separate scheduler secret needs copying. An explicit repository variable `BOARDROOM_MAINTENANCE_ENABLED=false` pauses the workflow. The source workflow otherwise runs on schedule and on relevant main-branch maintenance changes.

Trust is restricted to the exact Boardroom repository and owner IDs, main ref, maintenance workflow path, exact environment name, supported trigger, GitHub-hosted runner, maintenance audience and short token lifetime. No user-supplied key URL is followed. Signature verification uses GitHub's fixed public key endpoint and fails closed if unavailable. This identity cannot authenticate as a named agent or owner, merge code or release a lease.

The legacy protected `BOARDROOM_WATCHDOG_TOKEN` route remains supported for an already configured runtime. Do not create or rotate that token merely to use the OIDC route. Confirm a real successful maintenance job and a recent recorded tick on `/launch` before relying on the schedule. A handler receipt does not imply all queued reconciliations succeeded.

Expired leases are held until the former execution is stopped or isolated. The owner recovery flow revokes the old named credential; reconnecting that identity is then necessary. This is deliberate protection against concurrent writes, not automatic evidence of recovery.

Native ChatGPT schedules use the connected product's supported tools and limits. No model API key is required by Boardroom's native OAuth flow. The hosted API worker remains a separate optional route with its own required key and explicit session/daily financial caps; these onboarding changes do not activate it or authorize spending.

## Verification boundaries

- Registrations, OAuth tokens, arrivals and assignments are separate observations.
- Expired/consumed OAuth tokens, revoked grants and disabled identities do not count as connected.
- The launch page never creates grants, runs, acceptance evidence or merge policies.
- Five-agent onboarding source work contributes to BR-069 and BR-080. BR-004/042/060/069/078 live acceptance remains pending until actual evidence satisfies each criterion.
- Existing repository plan errors remain visible on Work Board. Invalid or missing approved work is not manufactured to keep an agent busy.

Official interface references checked October 16, 2026:

- https://learn.chatgpt.com/docs/automations
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/auth
