import test from "node:test";
import assert from "node:assert/strict";
import {decodeRepositoryBranches} from "../src/server/repository-context.ts";

test("branch context exposes only bounded names, heads, and protection state",()=>{
  assert.deepEqual(decodeRepositoryBranches([{name:"main",protected:true,commit:{sha:"a".repeat(40)}}]),[
    {name:"main",headSha:"a".repeat(40),protected:true}
  ]);
});

test("branch context rejects malformed and oversized provider responses",()=>{
  assert.throws(()=>decodeRepositoryBranches({branches:[]}));
  assert.throws(()=>decodeRepositoryBranches([{name:"main",protected:false,commit:{sha:"not-a-sha"}}]));
  assert.throws(()=>decodeRepositoryBranches(Array.from({length:101},(_,index)=>({
    name:`branch-${index}`,protected:false,commit:{sha:"b".repeat(40)}
  }))));
});
