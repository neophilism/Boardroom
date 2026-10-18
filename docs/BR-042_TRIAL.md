# BR-042 live scheduled-trial evidence

This unit is accepted only after real scheduled-origin **server evidence** links arrival, claim, an authorized repository change, mapped PR, exact-current-head CI, checkpoint, and confirmed release with timestamps. Passing structural tests, a manual activation, a pending check, or a synthetic fixture is insufficient.

The trialProblems helper checks **internal consistency only**. An arbitrary caller can set origin to "scheduled"; the helper cannot independently authenticate that claim. Even zero reported problems do not constitute operational acceptance, check provenance, a reviewed PR, or merge authorization.

A real scheduled activation can resume a PR opened in an earlier run. In that case, retain the original GitHub prOpenedAt and also require an independently verified prObservedAt between this run's commit and current-head CI observation. Do not mistake the older PR opening timestamp for a new creation.

Corroborate arrival, claim, fenced change, checkpoint and final lease release against Boardroom's private coordinator records. Corroborate mapped PR, exact SHA, CI job results and observation timestamps against the authenticated GitHub App. Preserve links and actual timestamps in a private checkpoint; do not publish session IDs, private audit entries, or owner-only requests in this repository. Release can only be verified **after** boardroom_finish, so a subsequent authorized run must reconcile it. CI-green code is not equivalent to satisfying the real scheduled-trial acceptance gate.
