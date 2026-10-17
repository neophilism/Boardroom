/** Shared admission/write rule for the roadmap_units alias w.
 * Every unresolved engineering question needs a source-backed answer. A failed
 * retry consumes older answers; another BLOCKED outcome needs fresh evidence.
 * This permits verification work, never acceptance or owner-approval bypass.
 */
export const TECHNICAL_RECOVERY_ELIGIBLE_SQL=String.raw`
(
  (
    w.state <> 'BLOCKED'
    AND NOT EXISTS (
      SELECT 1 FROM coffee_threads recovery_thread
      WHERE recovery_thread.repository_id=w.repository_id
        AND recovery_thread.unit_id=w.unit_id
        AND recovery_thread.status IN ('OPEN','ANSWERED')
    )
  )
  OR (
    EXISTS (
      SELECT 1 FROM coffee_threads recovery_thread
      WHERE recovery_thread.repository_id=w.repository_id
        AND recovery_thread.unit_id=w.unit_id
        AND recovery_thread.status IN ('OPEN','ANSWERED')
    )
    AND NOT EXISTS (
      SELECT 1 FROM coffee_threads recovery_thread
      WHERE recovery_thread.repository_id=w.repository_id
        AND recovery_thread.unit_id=w.unit_id
        AND recovery_thread.status IN ('OPEN','ANSWERED')
        AND (
          recovery_thread.status <> 'ANSWERED'
          OR NOT EXISTS (
            SELECT 1 FROM coffee_messages recovery_answer
            WHERE recovery_answer.thread_id=recovery_thread.thread_id
              AND recovery_answer.message_kind='ANSWER'
              AND jsonb_array_length(recovery_answer.evidence)>0
              AND recovery_answer.created_at>=recovery_thread.created_at
              AND recovery_answer.created_at>COALESCE((
                SELECT MAX(recovery_run.started_at)
                FROM work_assignments recovery_assignment
                JOIN agent_runs recovery_run ON recovery_run.run_id=recovery_assignment.run_id
                WHERE recovery_assignment.repository_id=w.repository_id
                  AND recovery_assignment.unit_id=w.unit_id
                  AND recovery_assignment.outcome='BLOCKED'
                  AND recovery_assignment.released_at IS NOT NULL
              ),'-infinity'::timestamptz)
          )
        )
    )
  )
)
`;
