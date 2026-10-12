# BR-082 — Owner session mutation authentication behind Render

Boardroom validates owners in two steps: an authenticated signed HttpOnly owner session cookie and, for browser mutations, a trusted external origin/CSRF check. The former does not imply the latter.

## Why the first import button returned 401

The original `authorizeOwnerRequest(request,true)` compared the browser's Origin to `new URL(request.url).origin`. With Next.js behind Render's reverse proxy, the application may see an internal HTTP request URL while the browser actually connects to `https://boardroom-iamn.onrender.com`. That can reject an otherwise valid owner session with 401.

Now browser POST/PUT operations compare Origin only to a **trusted, server-configured public origin**: `BOARDROOM_PUBLIC_ORIGIN` (if supplied), Render's `RENDER_EXTERNAL_URL`, or Boardroom's documented fixed external HTTPS hostname. No caller-provided `Host` or `X-Forwarded-Host` header can authorize a different origin. Missing Origin is allowed when the browser positively supplies `Sec-Fetch-Site: same-origin`, or, for privacy-focused browsers omitting that header too, when the `Referer` header independently identifies the exact trusted public origin. Cross-site Fetch Metadata is always rejected, and absent/foreign evidence fails closed. A recognized cookie with a rejected origin is a 403 in the setup/import APIs, not a 401 invalid-session response.

The import UI now distinguishes invalid/expired login (401), rejected origin (403), and backend verification errors (503). Tests reproduce the proxy mismatch and ensure cross-site requests stay blocked. These tests do not confirm whether the separate GitHub App credentials authenticate successfully.

## Later deployment

For an owner-controlled custom domain, configure `BOARDROOM_PUBLIC_ORIGIN=https://YOUR-EXACT-HOST` securely on Render (the canonical origin without a path); never use untrusted browser-supplied forwarding headers. Continue protecting all browser mutations with signed owner cookies and exact Origin checks.
