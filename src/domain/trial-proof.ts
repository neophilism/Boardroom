/** Fail closed when a scheduled GitHub trial lacks real evidence. */
export type TrialProof = { origin: "scheduled" | "manual" | "synthetic"; runId: string; generation: string; repository: string; branch: string; headSha: string; prUrl: string; ciHeadSha: string; ciStatus: "success" | "pending" | "failure" | "unknown"; arrivedAt: string; claimedAt: string; committedAt: string; prOpenedAt: string; ciObservedAt: string; finishedAt: string; released: boolean };
export function trialProblems(e: TrialProof): string[] {
  const failures: string[] = [];
  if (e.origin !== "scheduled") failures.push("Not an independently verified scheduled activation");
  if (!e.runId || !e.generation || !e.repository || !e.branch) failures.push("Missing assignment identity");
  if (!/^[a-f0-9]{40}$/i.test(e.headSha)) failures.push("Invalid commit SHA");
  if (e.headSha !== e.ciHeadSha || e.ciStatus !== "success") failures.push("Current-head CI has not succeeded");
  if (!e.prUrl.startsWith(`https://github.com/${e.repository}/pull/`)) failures.push("PR is not mapped to repository");
  const times = [e.arrivedAt, e.claimedAt, e.committedAt, e.prOpenedAt, e.ciObservedAt, e.finishedAt].map(Date.parse);
  if (times.some(t => !Number.isFinite(t))) failures.push("Missing or invalid timestamps");
  else if (times.some((t, i) => i > 0 && t < times[i - 1]!)) failures.push("Event chronology is invalid");
  if (!e.released) failures.push("Run release is unverified");
  return failures;
}
