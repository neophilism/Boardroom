# BR-051 malformed-encoding privacy regression

## Finding and bounded repair

At source `70e6271020b75c9a78b33a82f35baf94ddb0fbaf`, the privacy
normalizer attempted `decodeURIComponent` for each contiguous percent-encoded
run. A single invalid UTF-8 byte made that decoder throw and retain the entire
run unchanged. Valid encoded credential bytes or personal-data patterns next
to the invalid byte could then escape both read-time withholding and the
shared GitHub evidence-reference filter.

The normalizer now decodes those byte runs with replacement for invalid UTF-8.
It retains the existing two-pass percent normalization, Unicode normalization,
zero-width handling, raw input length cap, and all sensitive-data patterns.
The replacement representation is used only for inspection. It is never stored,
rendered, used to request a URL, or treated as authentication or permission.
Safe text is still returned byte-for-byte by `safeDiscussionText`.

No owner authorization, moderation authority, repository scope, posting rate,
retention policy, merge rule, or execution limit is changed. No existing test or
workflow is removed or weakened. Detection remains a privacy backstop, not a
claim that arbitrary sensitive text or every encoding is recognized.

## Evidence and tests

`tests/discussion-encoding.test.ts` adds 28 regression tests. Constructed
synthetic fixtures exercise invalid leading/trailing bytes, malformed multibyte
sequences, all standalone byte values from 0x80 through 0xff, two encoding
layers, fullwidth/zero-width characters, multiple existing sensitive-data
patterns, GitHub evidence paths, and original-text preservation. No real key,
account, personal record, or external service is used.

Against unchanged source, the new suite reports 23 failing and five passing
tests. With the repair, all 28 pass. Together with the unchanged four
`coffee-view.test.ts` tests, the focused local run passes 32 tests with no skips:

```sh
node --experimental-strip-types --test tests/discussion-encoding.test.ts tests/coffee-view.test.ts
```

Observed runtime: Node 22.16.0 in a subprocess with a cleared environment and
no service credentials. A focused no-emit type check of the two domain modules
passed with the available TypeScript 5.8.3; this is not the lockfile toolchain or
full project type check. The existing `npm test` glob includes the new suite.
Full application, PostgreSQL, sandbox and dependency checks still need actual
current-head CI. Earlier PR #107 success belongs to its earlier head, not this
change.

## Remaining work

This is an additional source fix on the existing BR-051 PR, not full unit
acceptance. The previously identified main/PR integration conflict, including
maintenance and migration-manifest changes, still requires source-preserving
resolution through the authorized fenced workflow. No branch integration,
merge, deployment, or production-retention action is asserted here.
