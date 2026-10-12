/** Pure, deterministic queue selection. Persistence/locking happen separately. */
export type RepositoryCandidate = {
  id: number;
  fullName: string;
  createdAt: string;
  lastDevelopmentAt: string | null;
  eligible: boolean;
  leaseHeld: boolean;
};

function effectiveUpdate(repo: RepositoryCandidate): number {
  const value = Date.parse(repo.lastDevelopmentAt ?? repo.createdAt);
  if (!Number.isFinite(value)) throw new Error("Invalid source timestamp for " + repo.fullName);
  return value;
}

export function selectRepository(
  candidates: readonly RepositoryCandidate[],
  priorityRepositoryIds: readonly number[]
): RepositoryCandidate | null {
  const available = new Map(
    candidates.filter(repo => repo.eligible && !repo.leaseHeld).map(repo => [repo.id, repo] as const)
  );
  for (const id of priorityRepositoryIds) {
    const match = available.get(id);
    if (match) return match;
  }
  const prioritized = new Set(priorityRepositoryIds);
  return [...available.values()]
    .filter(repo => !prioritized.has(repo.id))
    .sort((a, b) => effectiveUpdate(a) - effectiveUpdate(b) || a.id - b.id)[0] ?? null;
}
