import test from "node:test";
import assert from "node:assert/strict";
import {parseOwnerAction} from "../src/server/owner-actions.ts";
import {SessionConflict} from "../src/server/sessions.ts";
const base={
  runId:"7d54a632-94aa-4a9b-b84f-58ebaa0c7208",generation:"2",
  actionKey:"github:repo:deploy-token",title:"Create scoped deployment token",
  type:"CREDENTIAL",instructions:"Create a GitHub fine-grained token scoped to the specified repository with Contents read/write and Pull Requests write.",
  requestedPermissions:["Contents: read/write","Pull requests: write"],
  secureEntryLocation:"Render dashboard environment settings",priceEstimateCents:null
};
test("agent owner action describes human task without storing secret value",()=>{
  const parsed=parseOwnerAction(base);
  assert.equal(parsed.actionKey,"github:repo:deploy-token");
  assert.equal(parsed.type,"CREDENTIAL");
  assert.deepEqual(parsed.requestedPermissions,base.requestedPermissions);
});
test("private key and API token values are rejected",()=>{
  assert.throws(()=>parseOwnerAction({...base,instructions:"Please paste github_pat_ABCDEFGHIJKLMN1234567890 in the environment."}),SessionConflict);
  assert.throws(()=>parseOwnerAction({...base,instructions:"The key is sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJK"}),SessionConflict);
});
test("invalid owner actions and prices are rejected",()=>{
  assert.throws(()=>parseOwnerAction({...base,actionKey:"x"}));
  assert.throws(()=>parseOwnerAction({...base,priceEstimateCents:-2}));
  assert.throws(()=>parseOwnerAction({...base,requestedPermissions:Array(50).fill("x")}));
});
