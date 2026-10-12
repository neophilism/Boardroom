import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { isApprovedAgentName } from "../domain/agent-names.ts";

export class InvalidAgentCredential extends Error {
  constructor() { super("Invalid agent credential"); this.name = "InvalidAgentCredential"; }
}

export type AuthenticatedAgent = {
  credentialId: string;
  label: string;
  provider: string;
};

export function digestCredential(token: string, pepper: string): string {
  if (pepper.length < 32) throw new Error("BOARDROOM_TOKEN_PEPPER must contain 32+ characters");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new InvalidAgentCredential();
  return createHmac("sha256", pepper).update("boardroom-agent-v1\0" + token).digest("hex");
}

export function digestActivation(credentialId: string, activationKey: string, pepper: string): string {
  if (!/^[A-Za-z0-9._:-]{12,128}$/.test(activationKey)) throw new Error("Invalid Idempotency-Key");
  return createHmac("sha256", pepper).update("boardroom-arrival-v1\0" + credentialId + "\0" + activationKey).digest("hex");
}

export async function authenticateAgent(headers: Headers, db: Pool): Promise<AuthenticatedAgent> {
  const authorization = headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
  if (!match) throw new InvalidAgentCredential();
  const pepper = process.env.BOARDROOM_TOKEN_PEPPER;
  if (!pepper) throw new Error("BOARDROOM_TOKEN_PEPPER is missing");
  const digest = digestCredential(match[1], pepper);
  const result = await db.query<{credential_id: string; label: string; provider: string}>(
    "SELECT credential_id, label, provider FROM agent_credentials WHERE token_digest=$1 AND enabled=TRUE AND revoked_at IS NULL",
    [digest]
  );
  if (result.rowCount !== 1) throw new InvalidAgentCredential();
  const credential = result.rows[0];
  if (!isApprovedAgentName(credential.label)) throw new InvalidAgentCredential();
  return {credentialId:credential.credential_id,label:credential.label,provider:credential.provider};
}
