import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_MIGRATIONS or DATABASE_URL must be configured");
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query("SELECT pg_advisory_lock(540001)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    );
    const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
    const filenames = (await readdir(directory)).filter(file => /^\d+_[\w-]+\.sql$/.test(file)).sort();
    for (const filename of filenames) {
      const sql = await readFile(path.join(directory, filename), "utf8");
      const sha256 = createHash("sha256").update(sql).digest("hex");
      const current = await db.query<{ sha256: string }>("SELECT sha256 FROM schema_migrations WHERE filename=$1", [filename]);
      if (current.rowCount) {
        if (current.rows[0].sha256 !== sha256) throw new Error("Migration was edited after application: " + filename);
        console.log("already applied:", filename);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO schema_migrations(filename,sha256) VALUES($1,$2)", [filename, sha256]);
        await db.query("COMMIT");
        console.log("applied:", filename);
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try { await db.query("SELECT pg_advisory_unlock(540001)"); } finally { await db.end(); }
  }
}
migrate().catch(error => { console.error(error); process.exitCode = 1; });
