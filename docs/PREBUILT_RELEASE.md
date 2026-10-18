# Prebuilt Boardroom release (BR-077)

The existing native Render build can be unavailable after the workspace exhausts
pipeline minutes. Build the same application on a standard GitHub runner and
deploy its immutable image on the existing Render service. Additional authorized
deployment spending is zero. Do not create another service or raise any cap.

The container workflow runs only for a public source repository. It builds a
non-root linux/amd64 image, starts it against disposable PostgreSQL 17, runs the
unchanged startup migrations, verifies the exact source SHA and readiness, and
checks anonymous owner-API denial. No production secret, runtime database copy,
private operational record, Actions artifact or remote build cache is uploaded.
The production image includes compiled application/source files already public
in this repository, not runtime environment variables.

After merge, a separately scoped publish job uses the repository Actions token
to push `ghcr.io/neophilism/boardroom:sha-<main-commit>`. The workflow summary
records the registry digest. A successful push is not proof of anonymous access:
new GHCR packages can initially be private. Verify an unauthenticated image pull;
if necessary, make this public-source image package public in its package
settings. Do not expose a private package or production secret by inference.

For the existing Render web service, open Settings > Build > Source > Edit and
select Existing Image with the verified immutable reference. Preserve its
existing name, URL, free instance plan, region, environment variables and Neon
database. Leave pre-deploy empty; the container CMD runs startup migrations and
binds to `0.0.0.0:$PORT`. Source switching can trigger deployment. The Render MCP
connector does not expose source editing; use the authorized Dashboard or API.
Normal runtime and registry restrictions still apply. Diagnose returned failures
without increasing spending or claiming a completed rollout.

Confirm deployment is live and `/api/health.revision` equals the image's source
commit, `/api/ready` returns ready, anonymous `/api/v1/owner/agents` returns 401,
and an existing named connector profile serves the intended scheduled policy.
`BOARDROOM_BUILD_REVISION` carries the public baked SHA and takes precedence over
stale native `RENDER_GIT_COMMIT` metadata. Preserve exact image digests for rollback.

Image-backed services need a deployment trigger after publishing a newer image;
moving a registry tag alone does not deploy. Do not publish mutable release tags
or add an unauthorized credential merely to automate that trigger. An existing
authorized deployment operator can select the new digest and verify rollout.

References verified during implementation:

- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/billing/concepts/product-billing/github-packages
- https://render.com/docs/deploying-an-image
- https://render.com/changelog/change-your-services-backing-repo-or-image-in-the-render-dashboard
