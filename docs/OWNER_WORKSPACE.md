# Private owner workspace (BR-061)

## Navigation and authorization

All eleven private areas share the same authenticated navigation: Work board,
Owner actions, Coffee Corner, Operations, Audit trail, Priorities, Agent
identities, Agent launch, Recovery, Daily report and System connections. Existing
URLs and nested action/thread links are unchanged. Public sign-in, setup, health,
OAuth metadata and connection-consent routes stay outside this workspace shell.

Each private route has a server layout which verifies the signed HTTP-only
owner-session cookie before rendering navigation. **Each page keeps its own
authorization check before private database reads.** Next can render layouts and
pages in parallel; a layout alone is not an adequate data boundary. API routes
retain their independent role, lease, approval and origin checks. Neither an
agent bearer credential nor a claimed name grants access to these owner pages.

Private layouts remain dynamic/non-cacheable. Primary navigation prefetch is
disabled; explicit unauthenticated RSC-prefetch requests are also tested. A
successful owner sign-in can return to a known private view or the existing OAuth
consent URL, never an arbitrary host or API endpoint. Layout redirects preserve
the section, not arbitrary query contents. The existing single-owner secret
login is not newly certified MFA-backed identity.

## Responsive and keyboard behavior

Desktop shows persistent section navigation alongside page content. At 900px
and below, a disclosure button controls the same navigation. It reports
`aria-expanded`, closes on selection/path change, and Escape within the open
navigation restores focus to the menu button. This is a non-modal disclosure:
keyboard focus is not trapped. Each destination has a visible label and an
active `aria-current=page` state, including action/thread detail pages.

A first-focus skip link moves to page content. Navigation targets are at least
44px tall and focus indicators remain visible. Long audit identifiers wrap;
audit rows stack on narrow screens. Existing page-specific data controls remain
in their owning views; repeated global navigation blocks were removed.

Sign-out posts through the shared control and uses a full sign-in navigation to
discard the private router cache. The endpoint uses the existing authenticated
trusted-public-origin guard, not the internal proxy request URL. Cross-site
logout is denied without clearing the cookie. A network failure keeps a visible
retry message instead of pretending the session was cleared. Expired sessions
return to sign-in. Shared error boundaries display no raw error or provider
payload and do not infer healthy status from a failure.

## Read-only audit view

`/audit` shows timestamp, fixed event-kind text and repository identity only. Its
query does **not** select raw details, request bodies, credential/secret
references or provider payloads. The view states that an audit receipt is not
proof of completed development. Reads use a fixed 51-row query, display at most
50 rows and page by validated positive bigint event IDs. Invalid cursors safely
return to the latest page. This is not a new write API, event retention policy,
or the full cross-session timeline planned in BR-065.

## Repeatable evidence and limitations

`scripts/verify-owner-ui-http.mjs` starts a production Next server with an
explicit read-only PostgreSQL stub and fixture-only session key. Its subprocess
inherits no service credentials and forbids external fetches and DB mutations.
It checks all eleven private sections and two nested pages with anonymous,
agent, tampered-cookie and expired-cookie requests **before any DB read**, plus
RSC-prefetch denial, authenticated core views, audit paging, no-store responses
and proxy-safe/cross-origin logout. The existing CI consent-HTTP step runs this
fixture too. The fake audit rows are never live activity evidence.

On GitHub Actions the same verification also runs
`scripts/verify-owner-ui-browser.mjs` against the runner's installed Chrome via
the built-in DevTools protocol, without a downloaded browser package or provider
credentials. It checks desktop 1440px and mobile 390/320px, overflow, active
links, menu state, navigation targets, Escape/focus, skip link, client navigation
and access after cookie removal. Missing Chrome is an explicit failure, not a
reported pass. Local execution without Chrome still has HTTP coverage and must
not claim browser verification. Run the browser script directly on a machine
with Chrome installed to repeat it outside CI.

These are source-bound fixture checks, not live production/private-data or
independent accessibility-certification evidence. Verify the deployed head and
real owner session behavior before marking operational acceptance. No database
migration, paid dependency/service, additional schedule, permission expansion or
spending is introduced. Preserve separate moderation/recovery/webhook changes
when reconciling pending parallel PRs; rerun current-head checks after conflicts.
