import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";

test("readiness manifest covers the entire immutable SQL migration inventory",async()=>{
  const directory=new URL("../db/migrations/",import.meta.url);
  const files=(await readdir(directory)).filter(file=>/^\d+_[\w-]+\.sql$/.test(file)).sort();
  assert.deepEqual(MIGRATION_MANIFEST.map(migration=>migration.filename),files,
    "Every added migration must update readiness; never edit applied SQL");
  for(const migration of MIGRATION_MANIFEST){
    const source=await readFile(new URL(migration.filename,directory));
    assert.equal(createHash("sha256").update(source).digest("hex"),migration.sha256,migration.filename);
  }
});
