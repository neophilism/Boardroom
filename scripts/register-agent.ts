/** Register a scoped activation principal using a high-entropy token provided on stdin.
 * Example: TOKEN="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')"
 *          printf '%s' "$TOKEN" | npm run register:agent -- "Connection label" "chatgpt"
 * Store token in the connected provider's secret manager; NEVER put it in the scheduled prompt.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { digestCredential } from "../src/server/agent-auth.ts";
import { requireApprovedAgentName } from "../src/domain/agent-names.ts";
import {normalizeAccountEmail} from "../src/server/agent-registration.ts";

const label = process.argv[2]?.trim();
// Owner-approved spelling is mandatory before any database or credential operations.
if (label) requireApprovedAgentName(label);
const provider = process.argv[3]?.trim();
const accountEmail=normalizeAccountEmail(process.argv[4]);
if (!label || !provider || label.length > 100 || provider.length > 80)
  throw new Error("Usage: npm run register:agent -- <label> <provider> <account-email> (token via stdin)");
const pepper = process.env.BOARDROOM_TOKEN_PEPPER ?? "";
const token = readFileSync(0,"utf8").trim();
const digest = digestCredential(token,pepper);
const connectionString = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL_MIGRATIONS or DATABASE_URL missing");
const db = new Client({connectionString});
try {
  await db.connect();
  const result = await db.query<{credential_id:string}>(
    "INSERT INTO agent_credentials(label,provider,token_digest,account_email) VALUES($1,$2,$3,$4) RETURNING credential_id",
    [label,provider,digest,accountEmail]
  );
  console.log("Registered credential ID:",result.rows[0].credential_id);
} finally {
  await db.end();
}
