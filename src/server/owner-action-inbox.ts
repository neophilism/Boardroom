export const OWNER_ACTION_INBOX_FILTERS = [
  "ALL",
  "OUTSTANDING",
  "BLOCKED",
  "AWAITING_VERIFICATION",
  "COMPLETE",
  "DECLINED"
] as const;

export const OWNER_ACTION_INBOX_SORTS = ["OLDEST", "NEWEST", "STATUS", "TITLE"] as const;

export type OwnerActionInboxFilter = typeof OWNER_ACTION_INBOX_FILTERS[number];
export type OwnerActionInboxSort = typeof OWNER_ACTION_INBOX_SORTS[number];

type InboxAction = {
  action_id: string;
  title: string;
  status: string;
  created_at: Date | string;
};

const filterStatuses: Record<Exclude<OwnerActionInboxFilter, "ALL">, readonly string[]> = {
  OUTSTANDING: ["OPEN"],
  BLOCKED: ["ACKNOWLEDGED"],
  AWAITING_VERIFICATION: ["AWAITING_VERIFICATION"],
  COMPLETE: ["VERIFIED"],
  DECLINED: ["DECLINED"]
};

const statusOrder = new Map([
  "OPEN",
  "ACKNOWLEDGED",
  "AWAITING_VERIFICATION",
  "VERIFIED",
  "DECLINED",
  "CANCELLED"
].map((status, index) => [status, index]));

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseOwnerActionInboxView(params: Record<string, string | string[] | undefined>): {
  filter: OwnerActionInboxFilter;
  sort: OwnerActionInboxSort;
} {
  const requestedFilter = single(params.status)?.toUpperCase();
  const requestedSort = single(params.sort)?.toUpperCase();
  return {
    filter: OWNER_ACTION_INBOX_FILTERS.includes(requestedFilter as OwnerActionInboxFilter)
      ? requestedFilter as OwnerActionInboxFilter
      : "ALL",
    sort: OWNER_ACTION_INBOX_SORTS.includes(requestedSort as OwnerActionInboxSort)
      ? requestedSort as OwnerActionInboxSort
      : "OLDEST"
  };
}

export function selectOwnerActionInbox<T extends InboxAction>(
  actions: readonly T[],
  filter: OwnerActionInboxFilter,
  sort: OwnerActionInboxSort
): T[] {
  const selected = filter === "ALL"
    ? [...actions]
    : actions.filter(action => filterStatuses[filter].includes(action.status));

  return selected.sort((left, right) => {
    let comparison = 0;
    if (sort === "NEWEST") comparison = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    else if (sort === "STATUS") comparison = (statusOrder.get(left.status) ?? 99) - (statusOrder.get(right.status) ?? 99);
    else if (sort === "TITLE") comparison = left.title.localeCompare(right.title, "en", {sensitivity: "base"});
    else comparison = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();

    return comparison || left.action_id.localeCompare(right.action_id);
  });
}
