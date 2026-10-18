/** Structural consistency only. Independently verify server and GitHub provenance. */
export type TrialProof = {
  origin: "scheduled" | "manual" | "synthetic";
  runId: string;
  generation: string;
  repository: string;
  branch: string;
  headSha: string;
  prUrl: string;
  ciHeadSha: string;
  ciStatus: "success" | "pending" | "failure" | "unknown";
  arrivedAt: string;
  claimedAt: string;
  committedAt: string;
  prOpenedAt: string;
  /** For an existing mapped PR, the post-commit GitHub observation timestamp. */
  prObservedAt?: string;
  ciObservedAt: string;
  finishedAt: string;
  /** Authenticated coordinator observation of final lease release. */
  releasedAt: string;
  released: boolean;
};

function utcMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NaN;
  const normalized = new Date(parsed).toISOString().replace(/\.000Z$/, "Z");
  return normalized === value.replace(/\.000Z$/, "Z") ? parsed : NaN;
}

function mappedPrUrl(url: string, repository: string): boolean {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) return false;
  try {
    const parsed = new URL(url);
    const [owner, repo] = repository.split("/");
    const parts = parsed.pathname.split("/");
    return parsed.protocol === "https:" && parsed.hostname === "github.com" &&
      !parsed.port && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash && parts.length === 5 &&
      parts[1] === owner && parts[2] === repo && parts[3] === "pull" &&
      /^[1-9]\d*$/.test(parts[4]!);
  } catch {
    return false;
  }
}

/**
 * This is NOT an attestation. All fields are caller-supplied. Independently
 * corroborate scheduled origin, fenced writes, current-head CI and release.
 */
export function trialProblems(e: TrialProof): string[] {
  const failures: string[] = [];
  if (e.origin !== "scheduled") failures.push("Not an independently verified scheduled activation");
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(e.runId) ||
      !/^[1-9]\d*$/.test(e.generation) || !e.repository || !e.branch.trim()) {
    failures.push("Missing or malformed assignment identity");
  }
  if (!/^[a-f0-9]{40}$/i.test(e.headSha)) failures.push("Invalid commit SHA");
  if (e.headSha !== e.ciHeadSha || e.ciStatus !== "success") {
    failures.push("Current-head CI has not succeeded");
  }
  if (!mappedPrUrl(e.prUrl, e.repository)) failures.push("PR is not mapped to repository");

  const events = [e.arrivedAt, e.claimedAt, e.committedAt, e.ciObservedAt, e.finishedAt, e.releasedAt].map(utcMillis);
  const prOpened = utcMillis(e.prOpenedAt);
  const prObserved = e.prObservedAt === undefined ? NaN : utcMillis(e.prObservedAt);
  if (events.some(t => !Number.isFinite(t)) || !Number.isFinite(prOpened) ||
      (e.prObservedAt !== undefined && !Number.isFinite(prObserved))) {
    failures.push("Missing or invalid UTC timestamps");
  } else {
    if (events.some((t, i) => i > 0 && t < events[i - 1]!)) {
      failures.push("Event chronology is invalid");
    }
    if (prOpened > events[3]! ||
        (prOpened < events[2]! && (!Number.isFinite(prObserved) ||
          prObserved < events[2]! || prObserved > events[3]! || prObserved < prOpened))) {
      failures.push("Mapped PR was not observed after this run's commit");
    }
  }
  if (!e.released) failures.push("Run release is unverified");
  return failures;
}
