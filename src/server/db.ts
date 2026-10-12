import { Pool } from "pg";
let connection: Pool | undefined;

/** Lazily instantiated: code importing this module does not open a connection. */
export function getDatabase(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing: Boardroom database is not configured");
  return connection ??= new Pool({ connectionString: url, max: 8, idleTimeoutMillis: 15000 });
}
