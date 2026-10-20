import { Pool } from "pg";
let connection: Pool | undefined;

/** Lazily instantiated: importing this module does not open a connection.
 * A serverless function must not open eight pooled connections per warm instance.
 * Preserve the existing capacity for a single long-running Node.js server.
 */
export function getDatabase(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing: Boardroom database is not configured");
  const serverless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) || process.env.NETLIFY === "true";
  return connection ??= new Pool({
    connectionString: url,
    max: serverless ? 2 : 8,
    idleTimeoutMillis: serverless ? 5000 : 15000,
    connectionTimeoutMillis: 10000
  });
}
