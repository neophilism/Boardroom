# Priority and prerequisite enforcement (BR-043)

Explicit, approved cross-project links in `compatibility_dependencies` now influence dispatch priority as well as eligibility. An unfinished prerequisite inherits the highest owner priority of any unfinished approved consumer that depends on it, recursively. This lets the supporting project run ahead of unrelated older work without rewriting the owner's priority list. Once the prerequisite is verified merged/accepted, that edge stops lending priority. No dependency is inferred from a similar project name or a chat statement.

The recursive selector uses deduplicated repository/priority pairs. Cycles cannot loop forever: their blocked units remain ineligible, while independent eligible work can proceed. Cycles still require a corrected approved dependency plan; the scheduler does not break them by ignoring requirements.

Both same-project and cross-project prerequisites must retain approved source evidence as well as a merged/accepted state. A failed plan refresh that revokes approval cannot leave downstream work eligible merely because an older status says MERGED.

Before source publication or merge, Boardroom rechecks current local dependencies, compatibility dependencies and unresolved owner actions under the existing assignment lease lock. This catches requirements that changed after initial assignment. Declined and awaiting-verification requests continue to block writes; only VERIFIED or CANCELLED requests cease to block. Checkpoints and safe finish remain available. Owner pause also prevents advancement to a new unit.

Real PostgreSQL integration tests cover transitive priority, ordinary oldest-work fallback, revoked prerequisite approval, late local dependencies, owner-action lifecycle and cycle termination. Unit tests verify that a late owner blocker prevents any outbound GitHub write or merge request. These tests are implementation evidence, not live multi-project scheduled acceptance.
