# BR-085 — Qualified model snapshots and capability catalog

The empty, versioned `registry/provider-models.json` **qualifies no models**. Entries must be added by a subsequent source-backed review and actual conformance evidence; this PR does not connect a paid model, enable an API, mint a key, make billing assertions or claim frontier parity.

Each candidate identifies its provider, exact provider model ID and immutable revision, normalized context/output limits (or `null` unknown), modality, native reasoning settings, tool ability, an official HTTPS specification source and a freshness window. `QUALIFIED` additionally demands a pinned snapshot, a recent expiration within 90 days and a real Boardroom GitHub workflow-run evidence URL.

Runtime lookup `requireQualifiedModel` fails closed on unknown, candidate, retired, stale, unpinned or incompatible-effort models. It never silently maps `xhigh` to `high` or downgrades a provider/model. Provider model naming, aliases, caching, quotas and supported settings are genuinely vendor-specific and must be verified against official docs and tests at implementation time.

This is a structural registry, not a vendor-qualification report. Future BR-090–094 conformance tests populate it; BR-095 uses it to persist owner model selections, BR-086 handles pricing-version evidence, and BR-114 evaluates relative model quality at matched task difficulty. The existing hosted runner still uses its operator-supplied explicit `BOARDROOM_MODEL` but remains disabled by the independent paid API gate.

Because model aliases, documentation and billing may change quickly, intentionally avoid hardcoding an unverified "latest" model or exact price into source. Native ChatGPT Work plan credits are separate and not included.
