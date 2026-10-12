import roster from "../../registry/agent-names.json" with { type: "json" };

/** The owner-approved exact display-name roster is public information, not an authenticator. */
const permittedNames: ReadonlySet<string> = new Set(roster.names);

export class UnapprovedAgentName extends Error {
  constructor() { super("Agent name is not on the owner-approved roster"); this.name = "UnapprovedAgentName"; }
}

export function isApprovedAgentName(value: unknown): value is string {
  return typeof value === "string" && permittedNames.has(value);
}

/** Preserve spelling, case and punctuation; never silently normalize an identity. */
export function requireApprovedAgentName(value: unknown): string {
  if (!isApprovedAgentName(value)) throw new UnapprovedAgentName();
  return value;
}

export function approvedAgentNameCount(): number { return permittedNames.size; }
