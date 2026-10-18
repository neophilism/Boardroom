# Private per-repository execution limits

The owner can edit maximum session seconds, hosted tool calls and hosted tokens alongside each repository's merge policy on `/operations`. Inputs are range-checked, transactionally saved and audited. Older merge-only API requests preserve previously configured caps rather than silently resetting them.

Assigned context supplies the server's current caps and absolute deadline. The hosted runner uses the tighter runtime/repository limit, counts one activation across chained units, and adopts fresh limits when advancing. Reaching a token cap yields before reserving or sending another model request. The server also fences repository operations past the configured session deadline.

GitHub's hosted workflow now forwards the optional duration/tool variables. Empty optional settings retain bounded defaults. The shared daily cost cap remains a separate owner-managed setting; changing token/time limits does not authorize a paid worker or an increased financial cap.

Hosted token/tool counts come from the controlled runner. External provider runtimes must obey their own supported execution/spending controls; this interface does not obtain independent provider billing evidence. Production multi-provider conformance still requires real configured activations.

The default session cap is now 3,300 seconds (55 minutes) to support a
3,000-second useful-work target and checkpoint/release time. Migration 0017
updates the old 1,800-second default policies; customized caps and every
monetary/token/tool limit remain unchanged. Context exposes server-clock start,
work target and hard deadline. Project changes never restart that clock.
