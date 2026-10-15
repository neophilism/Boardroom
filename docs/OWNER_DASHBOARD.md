# Private Owner Action Board

The owner can access `/owner-actions` after a high-entropy owner credential is exchanged at `/login` for a signed, HttpOnly, SameSite=Strict 8-hour cookie. In production use HTTPS. `BOARDROOM_SESSION_SECRET` signs the cookie independently of `BOARDROOM_OWNER_API_TOKEN`. Never put either in public GitHub or browser JavaScript.

The inbox groups the lifecycle into owner-facing filters: outstanding (`OPEN`), blocked after acknowledgement (`ACKNOWLEDGED`), awaiting verification, complete, and declined. The owner can sort the current view by oldest, newest, lifecycle status, or title. Unsupported query-string values fail closed to the all-actions, oldest-first view.

Each request can be inspected in place without opening a chat window. The detail includes instructions, permission scopes, secure target, estimated price, affected repositories, request time, and status. The owner can acknowledge, decline, or mark an action complete pending verification. "I've done this" does not immediately unblock agents: verification remains a separate required step.

**Still pending:** OIDC/MFA user identity, secure secret entry and presence verification, real Neon deployment, rate limiting, operational access controls, integration tests and final security assessment. A code review of this PR cannot be substituted for production readiness.
