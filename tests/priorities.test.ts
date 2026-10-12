import test from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import {parsePriorityOrder,PriorityValidationError,replaceRepositoryPriority} from "../src/server/priorities.ts";

test("owner priority preserves explicit order and exact numeric GitHub repository ids",()=>{
  assert.deepEqual(parsePriorityOrder({repositoryIds:["42","9007199254740993","1"]}),["42","9007199254740993","1"]);
  assert.deepEqual(parsePriorityOrder({repositoryIds:[]}),[]);
});

test("duplicate, invalid, unsafe and oversized priority arrays fail closed",()=>{
  for(const ids of [[1],["0"],["-1"],["3.4"],["1","1"],["01"],["9223372036854775808"],new Array(2001).fill("1")])
    assert.throws(()=>parsePriorityOrder({repositoryIds:ids}),PriorityValidationError);
  assert.throws(()=>parsePriorityOrder(null),PriorityValidationError);
  assert.throws(()=>parsePriorityOrder({repositoryIds:"1"}),PriorityValidationError);
});

test("priority replacement is transactional and retains the caller's explicit ranking",async()=>{
  const events:Array<{sql:string;params:unknown[]|undefined}>=[];
  const client={
    query:async (sql:string,params?:unknown[])=>{
      events.push({sql,params});
      if(sql.includes("FROM repositories"))return {rowCount:2,rows:[{repository_id:"5"},{repository_id:"4"}]};
      return {rowCount:0,rows:[]};
    },release:()=>{}
  } as unknown as PoolClient;
  const db={connect:async()=>client} as unknown as Pool;
  const result=await replaceRepositoryPriority(db,["5","4"]);
  assert.deepEqual(result,{repositoryIds:["5","4"],count:2});
  assert.ok(events[0].sql.includes("BEGIN"));
  assert.ok(events.some(e=>e.sql.includes("pg_advisory_xact_lock")));
  const insert=events.find(e=>e.sql.includes("INSERT INTO repository_priority"));
  assert.deepEqual(insert?.params,[["5","4"]]);
  assert.ok(events.at(-1)?.sql.includes("COMMIT"));
});

test("unknown or disabled priority repository rolls back without changing the list",async()=>{
  const calls:string[]=[];
  const client={query:async (sql:string)=>{calls.push(sql);return sql.includes("FROM repositories")?{rowCount:0,rows:[]}:{rowCount:0,rows:[]}},release:()=>{}} as unknown as PoolClient;
  await assert.rejects(replaceRepositoryPriority({connect:async()=>client} as unknown as Pool,["123"]),PriorityValidationError);
  assert.ok(calls.at(-1)?.includes("ROLLBACK"));
  assert.ok(!calls.includes("DELETE FROM repository_priority"));
});
