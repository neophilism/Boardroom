# Native continuous-session completion (BR-039/040 follow-up)

Native agents were able to end a run after one PR or a short sequence of
checkpoints even while the 50-minute window and eligible portfolio work remained.
The native MCP finish tools now distinguish assignment release from activation
completion. Hosted workers retain their existing bounded orchestration loop.

- Before the target, ordinary completion checkpoints and releases the old
  assignment, then returns `CONTINUE_REQUIRED`, `runEnded:false` and
  `leaseReleased:true` when other eligible work remains. It does not acquire
  another repository lease. The agent acknowledges continuation by calling
  `boardroom_claim` with the same run ID, reading context and implementing work.
- A missing checkpoint returns continuation instructions while retaining the
  current lease. If checkpointing is actually unavailable across the activation,
  the finish request may supply an evidenced hard stop directly. A checkpoint
  failure must not prevent best-effort release.
- Idle completion cannot bypass continuation while eligible work remains.
  Actual queue exhaustion, the original target/deadline, owner pause and lost
  live authority still allow safe completion. No empty polling pads duration.
- An earlier activation-wide stop uses `sessionStop` with a bounded, secret-free
  `reason` and observed `evidence`. Older finish schemas can save it in the
  current unit's checkpoint. An unassigned agent can discover the updated
  finish-idle schema and supply it directly. The audit labels this evidence
  `AGENT_REPORTED`; it does not verify a platform limit merely because an agent
  says one exists. A pending PR is not an activation-wide capability failure.
- The hosted worker's configured model-tool and token caps remain unchanged.
  Context identifies their scope and reports native connector usage as unknown,
  rather than presenting 100 as a measured native-call allowance. Any actual
  host restriction, spending cap or authorization denial remains binding.
- An empty registry PR-link array does not itself reject the assigned default
  work branch. Candidates must still pass the PR-evidence gateway; alternate
  imported branches require verified source-owned numeric links. No mapping or
  branch-protection authority is inferred from checkpoint claims.

The shared versioned instruction combines these behaviors with recurring-task
preservation, exact error reporting, bounded recovery, same-run project handoff,
substantive implementation and best-effort truthful release. Updating a prompt
does not change an already-running activation or another account's schedules.

Real PostgreSQL tests exercise native MCP dispatch at a simulated 90 seconds,
checkpoint failure, same-run cross-project claim, stale-generation and credential
rejection, replay, idle bypass, exact-target completion and explicit hard stops.
Passing fixtures do not establish that the ChatGPT host actually ran for 50
minutes: that requires separately observed native-session duration and useful
development evidence. Boardroom cannot extend an external host's lifetime.
