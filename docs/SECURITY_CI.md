# BR-075 — Boardroom security inspection in GitHub Actions

The public Boardroom repository now runs two additional automated checks: GitHub CodeQL v4 analysis of JavaScript/TypeScript with the `security-extended` query suite, and a high-severity-or-above vulnerability audit of production npm dependencies. These run on PRs, main pushes, and weekly (CodeQL). Source code is analyzed using GitHub's supported public-repository hosted runners.

This is **additional static security inspection**, not a substitute for human expert review, penetration testing, protected-branch enforcement, dynamic security tests, or verification of deployed credentials. CodeQL findings must be reviewed and fixed before declaring the corresponding vulnerability resolved. Automatic merges must not treat these checks as proof of complete code quality.

Changes that fail security checks must be repaired or explicitly escalated to the owner; do not silently disable gates.
