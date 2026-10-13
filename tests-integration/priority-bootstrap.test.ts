import test from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {ensureDefaultRepositoryPriority} from "../src/server/repository-priority-bootstrap.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Priority fixtures require the explicit boardroom_test database");

test("inventory bootstrap respects the production deferrable position constraint and owner order",async()=>{
  const db=new Pool({connectionString:url,max:1});
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    // Copy the actual migrated constraints into private tables so other database
    // concurrency suites can keep exercising the shared production tables.
    await client.query("CREATE TEMP TABLE repositories (LIKE public.repositories INCLUDING ALL) ON COMMIT DROP");
    await client.query("CREATE TEMP TABLE repository_priority (LIKE public.repository_priority INCLUDING ALL) ON COMMIT DROP");
    const read=async()=> (await client.query("SELECT repository_id::text,position FROM repository_priority ORDER BY position")).rows;
    await ensureDefaultRepositoryPriority(client,"ci/Boardroom");
    assert.deepEqual(await read(),[]);
    await client.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES(1,'ci/Boardroom',now()),(2,'ci/Other',now())");
    await ensureDefaultRepositoryPriority(client,"ci/Boardroom");
    await ensureDefaultRepositoryPriority(client,"ci/Boardroom");
    assert.deepEqual(await read(),[{repository_id:"1",position:1}]);
    await client.query("DELETE FROM repository_priority");
    await client.query("INSERT INTO repository_priority(repository_id,position) VALUES(2,1)");
    await ensureDefaultRepositoryPriority(client,"ci/Boardroom");
    assert.deepEqual(await read(),[{repository_id:"2",position:1}]);
    await client.query("COMMIT");
  }finally{
    await client.query("ROLLBACK");
    client.release();await db.end();
  }
});
