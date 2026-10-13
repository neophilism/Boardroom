# Control-plane backup and recovery

The backup script writes a custom-format PostgreSQL archive with mode 0600, using a direct URL supplied only through runtime secrets. Never store the resulting private runtime backup in public GitHub. Use an access-controlled backup destination and the owner's retention policy. No actual backup is created by this source commit.

For recovery, use an EMPTY database and explicitly set `BOARDROOM_RESTORE_CONFIRMED=true` with `BOARDROOM_RESTORE_DATABASE_URL` in the protected operator runtime. `scripts/restore-control-plane.ts` refuses a nonempty target, restores without owner/ACL privileges, revokes old agent credentials, cancels old sessions, increments all lease generations, disables repositories and pauses execution. Reconcile actual GitHub state and verify outside worker termination before enabling anything. Restore correctness must be tested against a real private backup in an isolated recovery environment before BR-076 passes.
