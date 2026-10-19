# BR-061 disclosure and no-script navigation follow-up

Source base: `bb749bfb81cf25a93be8bf9972ee13cbbc8d4a22`, existing PR #110.

The open sidebar handled Escape, but the menu control lives outside that sidebar.
Escape on the focused control therefore left the mobile disclosure open. The header
and sidebar now share the same handler; only Escape while open consumes the event,
closes the disclosure and restores focus. Other keys and closed-menu focus behavior
remain unchanged. This is still a non-modal disclosure with no focus trap.

The narrow-screen stylesheet hid navigation until a JavaScript event toggled it.
An authenticated owner without JavaScript therefore could not use the section links.
A no-script-only style now exposes the existing server-rendered navigation and hides
the inert disclosure toggle. It creates no alternate data path or authorization
mechanism. Interactive controls, including sign-out, still require JavaScript, and
the fallback explicitly states that limitation. No private layout/page/API guard,
session validation, cookie policy or server-side data query was changed.

Ten component-handler tests cover both event boundaries, closed/other-key behavior,
toggling, route changes, selection and the no-script contract. Against the original
component two failed and eight passed; all ten pass with this patch on Node 22.16.0
and TypeScript 5.8.3. These tests transpile the actual component with synthetic React
hooks: they are not React hydration, Next rendering or browser acceptance evidence.

A separate local Chromium experiment exercised the actual fallback CSS with synthetic
HTML at 320, 390 and 1440 pixels, both with and without page JavaScript: six cases
passed. It tests CSS/no-script parsing only, not live private pages. Its first cleanup
hit ENOTEMPTY; bounded temporary-profile cleanup retries resolved that harness error
and the complete rerun exited successfully. No credentials or external service were
used. The full Next/browser harness could not run locally because Next and React
project dependencies were not installed.

The existing real Next/Chrome harness is extended, not replaced: Escape is tested
while the menu button retains focus; all eleven sections are checked without page
JavaScript; and both sides of the 900/901-pixel breakpoint are checked. All existing
authentication, prefetch, focus, browser and responsive checks remain. Its JavaScript
syntax check passed locally. Actual current-head CI must run the complete harness;
prior green checks on the base SHA do not validate these changes. Full unit and live
operational acceptance, merge and deployment are not asserted here.
