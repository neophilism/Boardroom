export const COFFEE_STATUSES = ["OPEN", "ANSWERED", "RESOLVED", "CLOSED"] as const;
export type CoffeeStatus = typeof COFFEE_STATUSES[number];

export function parseCoffeeStatus(value: string | null): CoffeeStatus | null {
  if (!value) return null;
  return COFFEE_STATUSES.find(status => status === value) ?? null;
}

export function parseCoffeeSearch(value: string | null): string {
  if (!value) return "";
  return value.trim().slice(0, 100);
}

export function isCoffeeThreadId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

export function isSafeGitHubReference(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 450) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" &&
      !url.username && !url.password && !url.search && !url.hash &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\s]*)?$/.test(url.pathname.slice(1));
  } catch { return false; }
}
