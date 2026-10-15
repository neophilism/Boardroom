import test from "node:test";
import assert from "node:assert/strict";
import {parseOwnerActionResponse,respondToOwnerAction,resolveVerifiedOwnerAction,OwnerActionResolutionRejected} from "../src/server/owner-action-resolution.ts";

const actionId="7d54a632-94aa-4a9b-b84f-58ebaa0c7208";

function database(status="AWAITING_VERIFICATION",type="CREDENTIAL"){
  const calls:{sql:string;params?:unknown[]}[]=[];
  const client={query:async(sql:string,params?:unknown[])=>{
    calls.push({sql,params});
    if(sql.startsWith("SELECT action_type"))return {rowCount:1,rows:[{action_type:type,status}]};
    if(sql.startsWith("SELECT status"))return {rowCount:1,rows:[{status}]};
    if(sql.startsWith("SELECT repository_id"))return {rowCount:2,rows:[
      {repository_id:"41",unit_id:"A-1"},{repository_id:"42",unit_id:null}
    ]};
    return {rowCount:1,rows:[]};
  },release:()=>{}};
  return {db:{connect:async()=>client},calls};
}

test("verified provider evidence resolves one action and requeues every dependent scope",async()=>{
  const fixture=database();
  const result=await resolveVerifiedOwnerAction(fixture.db as never,actionId,{
    kind:"credential_capability",evidenceId:"github-check:938",verified:true
  });
  assert.deepEqual(result,{actionId,status:"VERIFIED",requeued:[
    {repositoryId:"41",unitId:"A-1"},{repositoryId:"42",unitId:null}
  ]});
  assert.ok(fixture.calls.some(call=>call.sql.includes("status=\'VERIFIED\'")));\n  assert.ok(fixture.calls.some(call=>call.sql.includes("other.action_id<>")&&call.sql.includes("NOT IN (\'VERIFIED\',\'CANCELLED\')")));
  const audit=fixture.calls.find(call=>call.sql.includes("fulfillment_verified"));
  assert.match(String(audit?.params?.[0]),/github-check:938/);
  assert.match(String(audit?.params?.[0]),/"repositoryId":"42"/);
});

test("unverified, secret-bearing, wrong-state, and approval evidence fail closed",async()=>{
  await assert.rejects(()=>resolveVerifiedOwnerAction(database().db as never,actionId,{
    kind:"credential_capability",evidenceId:"github-check:938",verified:false
  }),OwnerActionResolutionRejected);
  await assert.rejects(()=>resolveVerifiedOwnerAction(database().db as never,actionId,{
    kind:"credential_capability",evidenceId:"github_pat_ABC12345678901234567890",verified:true
  }),/evidence/);
  await assert.rejects(()=>resolveVerifiedOwnerAction(database("OPEN").db as never,actionId,{
    kind:"account_probe",evidenceId:"provider-check:7",verified:true
  }),/awaiting verification/);
  await assert.rejects(()=>resolveVerifiedOwnerAction(database("AWAITING_VERIFICATION","APPROVAL").db as never,actionId,{
    kind:"approval_probe",evidenceId:"provider-check:7",verified:true
  }),/exact approval verifier/);
});

test("clarification reopens a request while rejection stays final and auditable",async()=>{
  const clarify=database("AWAITING_VERIFICATION");
  assert.deepEqual(await respondToOwnerAction(clarify.db as never,actionId,{
    status:"OPEN",note:"Please identify the exact organization account to provision."
  }),{actionId,status:"OPEN"});
  assert.ok(clarify.calls.some(call=>call.params?.[0]==="owner_action.clarification_requested"));
  const decline=database("OPEN");
  assert.deepEqual(await respondToOwnerAction(decline.db as never,actionId,{
    status:"DECLINED",note:"This provider account is not approved for this project."
  }),{actionId,status:"DECLINED"});
  assert.ok(decline.calls.some(call=>call.sql.includes("resolved_at")));
  assert.ok(decline.calls.some(call=>call.params?.[0]==="owner_action.declined"));
});

test("clarification and rejection require bounded secret-free reasons",()=>{
  assert.throws(()=>parseOwnerActionResponse({status:"OPEN"}),/note is required/);
  assert.throws(()=>parseOwnerActionResponse({status:"DECLINED",note:"too short"}),/bounded/);
  assert.throws(()=>parseOwnerActionResponse({status:"DECLINED",note:"token=github_pat_ABC12345678901234567890"}),/secret-free/);
  assert.deepEqual(parseOwnerActionResponse({status:"AWAITING_VERIFICATION"}),{status:"AWAITING_VERIFICATION",note:null});
});
