# Owner-controlled repository import (BR-009 follow-up)

The authenticated Work Board now includes **Refresh from GitHub**. It makes short, sequential, origin-checked requests to `POST /api/v1/owner/repositories/sync` rather than requiring a shell on a free Render service or attempting one long request across the owner's entire GitHub portfolio.

The server enumerates only repositories installed for the configured GitHub App and owner `BOARDROOM_GITHUB_OWNER`. Each batch imports at most 10 repos (3 by default), sorted by immutable numeric GitHub repository ID. The browser continues with a cursor, shows real verified/missing/error counts, and refreshes the Work Board at completion. Failed repositories can be retried by starting another full refresh. Reconciliation never invents a roadmap or accepted PR.

**Prerequisites:** Boardroom's secure Render runtime variables, Neon connection and installed GitHub App must be configured. If these are absent the operation fails visibly. No secrets enter client-side JavaScript; the browser uses a signed owner session cookie and mutation origin checks. GitHub App credentials remain server-side. A working import is *not* proof of actual scheduled-agent development or safe PR auto-merge.


## Combined setup action

The authenticated System status page provides **Verify setup and import repositories**, which first validates the configured database and GitHub App installation and then runs the same bounded import API. This supersedes manually clicking verification and synchronization separately. The separate Work Board refresh remains available for subsequent maintenance.
