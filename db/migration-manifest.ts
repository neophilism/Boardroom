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
  {filename: "0011_coffee_posting_budget_index.sql", sha256: "814ce5baae5af4b83c75ecbae33ca5812be127016e5faa9e1647dad8bf12ef8e"}
  ,{filename: "0014_logical_agents.sql", sha256: "5209ab882e52e77b848b6c94877170354efd05dc1aef1a5682d5956c26f5b5ec"}
  ,{filename: "0015_api_spending_gate.sql", sha256: "ac79919e05a183dd746fd0dbf16775a9061ca3ec027d7639d6223151cfae6cfc"}
] as const;
