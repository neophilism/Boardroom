import test from "node:test";
import assert from "node:assert/strict";
import {classifyEscalation,parseOwnerAction} from "../src/server/owner-actions.ts";
import {SessionConflict} from "../src/server/sessions.ts";
const base={
  runId:"7d54a632-94aa-4a9b-b84f-58ebaa0c7208",generation:"2",
  actionKey:"github:repo:deploy-token",title:"Create scoped deployment token",
  type:"CREDENTIAL",condition:"OWNER_CREDENTIAL_PROVISION",
  instructions:"Create a GitHub fine-grained token scoped to the specified repository with Contents read/write and Pull Requests write.",
  requestedPermissions:["Contents: read/write","Pull requests: write"],
  secureEntryLocation:"Render dashboard environment settings",priceEstimateCents:null
};
test("agent owner action describes a classified human task without storing secret value",()=>{
  const parsed=parseOwnerAction(base);
  assert.equal(parsed.actionKey,"github:repo:deploy-token");
  assert.equal(parsed.type,"CREDENTIAL");
  assert.equal(parsed.condition,"OWNER_CREDENTIAL_PROVISION");
  assert.deepEqual(parsed.requestedPermissions,base.requestedPermissions);
});
test("classifier separates owner, peer, and autonomous conditions",()=>{
  assert.equal(classifyEscalation("OWNER_PURCHASE"),"OWNER_ACTION");
  assert.equal(classifyEscalation("TECHNICAL_QUESTION"),"COFFEE_CORNER");
  assert.equal(classifyEscalation("AUTONOMOUS_TEST_FAILURE"),"AUTONOMOUS");
});
test("technical and agent-capable work cannot become owner actions",()=>{
  assert.throws(()=>parseOwnerAction({...base,condition:"TECHNICAL_QUESTION"}),/Coffee Corner/);
  assert.throws(()=>parseOwnerAction({...base,condition:"AUTONOMOUS_CODE_CHANGE"}),/authorized agent work/);
  assert.throws(()=>parseOwnerAction({...base,condition:"RETRYABLE_EXTERNAL_FAILURE"}),/authorized agent work/);
});
test("owner condition must match the requested action type",()=>{
  assert.throws(()=>parseOwnerAction({...base,condition:"OWNER_PURCHASE"}),/does not match/);
  assert.throws(()=>parseOwnerAction({...base,condition:"made-up"}),/classification required/);
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
