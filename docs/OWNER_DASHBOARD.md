# Private Owner Action Board

The owner can access `/owner-actions` after a high-entropy owner credential is exchanged at `/login` for a signed, HttpOnly, SameSite=Strict 8-hour cookie. In production use HTTPS. `BOARDROOM_SESSION_SECRET` signs the cookie independently of `BOARDROOM_OWNER_API_TOKEN`. Never put either in public GitHub or browser JavaScript.

The UI shows action title, type, instructions, permission scopes, secure target, estimated price, affected repositories, and status. Acknowledge, decline, or mark complete pending verification. 'I've done this' does NOT immediately unblock agents: verification remains a separate required step.

**Still pending:** OIDC/MFA user identity, secure secret entry and presence verification, real Neon deployment, rate limiting, operational access controls, integration tests and final security assessment. A code review of this PR cannot be substituted for production readiness.
