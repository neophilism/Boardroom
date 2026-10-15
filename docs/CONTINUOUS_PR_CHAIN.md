# BR-039 — Continuous eligible PR chain

After the current work unit has authoritative `MERGED` or `ACCEPTED` evidence, an authenticated worker may request the next unit without releasing its repository lease. Boardroom advances the existing assignment in one database transaction and preserves the repository ID, assignment ID, lease generation and run ID.

Selection remains limited to approved units in that same repository. Local plan dependencies, source-owned cross-repository prerequisites, compatibility dependencies and unresolved Owner Actions must all be satisfied. Work already active or attached to an open PR is resumed before new pending work. A blocked unit is not selected unless it has a source-backed answered Coffee thread.

If no eligible unit remains, the endpoint returns `EXHAUSTED`; the runner checkpoints and finishes the session through the ordinary fenced release path. An unmerged current unit, stale generation, expired lease, revoked credential or owner pause fails closed. The chain endpoint cannot claim a second repository.
