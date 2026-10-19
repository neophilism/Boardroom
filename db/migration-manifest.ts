/** Public fingerprints of immutable migration source, never database credentials.
 * The inventory test must change alongside every newly approved migration.
 */
export const MIGRATION_MANIFEST = [
  {filename: "0001_core.sql", sha256: "845a552be29d120b140b1f7d41c87ccf3f6965bbe08a82ca78878b800a01e6b2"},
  {filename: "0002_agent_credentials.sql", sha256: "7d2371481da8e63491c8de32c214afacf8f9a84482fb6a51c3bbd84d69397c9c"},
  {filename: "0003_repository_sync.sql", sha256: "3a3577db09246606c9fc668e3d71d13b20e902dbbeeee4f6df7d68c870d4998b"},
  {filename: "0004_unique_named_principals.sql", sha256: "2898302b158fc7e09e9705c89e221ddc3e60dc21fdb59c35090047f9d9809972"},
  {filename: "0005_single_active_run_per_named_agent.sql", sha256: "828cf9b0b28b7004bfb73cb0ef8e50c96599f95ec6aae8d3480297a84901318a"},
  {filename: "0006_execution_controls.sql", sha256: "cbf5d2fbd4f77bbda847d10103f89fd59e5e28744ba5e8e5f15336ccdc4770b9"},
  {filename: "0007_native_mcp_oauth.sql", sha256: "9268c5d61a9b2bb9aacfab426cbcd66625aa627d6e96b7372e3ab860979208a3"},
  {filename: "0008_shared_pr_registry.sql", sha256: "8bb54ba2fa814d812d8d5d622574fa6a9cff8e53b8010eb491dc1e24bd444808"},
  {filename: "0009_owner_action_notification_batches.sql", sha256: "92f2c6762d88a617037264acb01c8199b9f43d64977481973527d7fb2bf8b5e6"},
  {filename: "0010_coffee_question_metadata.sql", sha256: "119244a91c769210f12bb115bf560c7060fb12c602a8cfbb615f25dae37765c6"},
  {filename: "0011_coffee_posting_budget_index.sql", sha256: "814ce5baae5af4b83c75ecbae33ca5812be127016e5faa9e1647dad8bf12ef8e"},
  {filename: "0012_agent_account_email.sql", sha256: "a21c6b0db61ffcde9a85e69414110b9481978cee9dcbad06a3eeb7b0c095cbd3"},
  {filename: "0013_agent_name_reservations.sql", sha256: "e803ac7bc945562b18667ad17325747cddacb61c0d94c2c95070c063859af522"},
  {filename: "0014_logical_agents.sql", sha256: "5209ab882e52e77b848b6c94877170354efd05dc1aef1a5682d5956c26f5b5ec"},
  {filename: "0015_outbox_supersession.sql", sha256: "f71463c46e9b682fc1a4464f75e50fce17c2e2feb9cf2e853415ce7044e79932"},
  {filename: "0017_continuous_work_sessions.sql", sha256: "017be471e795f9f199c83e5391cf0a61d8d9847788444c8ed51ef3f887b1b58b"}
] as const;
