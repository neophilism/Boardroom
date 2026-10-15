import test from "node:test";
import assert from "node:assert/strict";
import {executeApprovedRisk,parseRiskIntent,renderRiskApprovalRequest,riskApprovalActionKey,RiskApprovalRejected,verifyRiskApproval} from "../src/server/risk-approval.ts";

const runId="7d54a632-94aa-4a9b-b84f-58ebaa0c7208";
const credentialId="26741e83-9694-4fb3-8174-783b2f9bf61c";
const production={category:"PRODUCTION_RELEASE" as const,target:"neophilism/Boardroom release 1.0",summary:"Publish the exact reviewed commit to the production service.",maxCostCents:null};

test("all risky classes produce exact immutable approval keys",()=>{
  const keys=new Set<string>();
  for(const category of ["DESTRUCTIVE_ACTION","PRIVILEGE_CHANGE","LEGAL_OR_POLITICAL","PRODUCTION_RELEASE"] as const){
    const intent=parseRiskIntent({...production,category,target:`${category} target`});
    keys.add(riskApprovalActionKey(intent));
  }
  keys.add(riskApprovalActionKey(parseRiskIntent({category:"SPENDING",target:"Vendor plan",summary:"Purchase one bounded monthly service plan.",maxCostCents:2500})));
  assert.equal(keys.size,5);
  assert.notEqual(riskApprovalActionKey(production),riskApprovalActionKey({...production,summary:production.summary+" Now."}));
});

test("risk requests are secret-free and bind category, target, action, and cost",()=>{
  const request=renderRiskApprovalRequest({runId,generation:"2"},{category:"SPENDING",target:"Example hosting",summary:"Purchase the minimum monthly production tier.",maxCostCents:1900});
  assert.equal(request.type,"APPROVAL");
  assert.equal(request.condition,"OWNER_APPROVAL");
  assert.match(request.actionKey,/^approval:spending:[a-f0-9]{64}$/);
  assert.match(request.instructions,/Maximum cost cents: 1900/);
  assert.equal(request.priceEstimateCents,1900);
});

test("vague, secret-bearing, and unbounded spending intents are rejected",()=>{
  assert.throws(()=>parseRiskIntent({...production,summary:"too short"}),RiskApprovalRejected);
  assert.throws(()=>parseRiskIntent({...production,target:"token=github_pat_ABC12345678901234567890"}),RiskApprovalRejected);
  assert.throws(()=>parseRiskIntent({category:"SPENDING",target:"Vendor",summary:"Purchase the required service plan.",maxCostCents:null}),/positive maximum cost/);
  assert.throws(()=>parseRiskIntent({...production,maxCostCents:1}),/Only spending/);
});

function database(approved:boolean,used=false){
  const calls:string[]=[];
  const client={query:async(sql:string)=>{
    calls.push(sql);
    if(sql.includes("FROM agent_runs"))return {rowCount:approved?1:0,rows:approved?[{action_id:"a1",repository_id:"42",unit_id:"BR-028"}]:[]};
    if(sql.startsWith("SELECT 1 FROM audit_events"))return {rowCount:used?1:0,rows:used?[{one:1}]:[]};
    return {rowCount:1,rows:[]};
  },release:()=>{calls.push("RELEASE")}};
  return {db:{connect:async()=>client},calls};
}

test("an unapproved scheduled attempt never invokes the risky adapter",async()=>{
  const {db}=database(false);let executed=false;
  await assert.rejects(()=>executeApprovedRisk(db as never,runId,credentialId,"2",production,async()=>{executed=true;}),/Exact verified owner approval required/);
  assert.equal(executed,false);
});

test("an exact approval is consumed before one execution and cannot be reused",async()=>{
  const first=database(true);let executions=0;
  const result=await executeApprovedRisk(first.db as never,runId,credentialId,"2",production,async()=>{executions++;return "done";});
  assert.equal(result,"done");assert.equal(executions,1);
  assert.ok(first.calls.some(sql=>sql.includes("owner.risk_approval.consumed")));
  const second=database(true,true);
  await assert.rejects(()=>executeApprovedRisk(second.db as never,runId,credentialId,"2",production,async()=>{executions++;}),/already consumed/);
  assert.equal(executions,1);
});

test("the owner can verify only an exact risk approval action",async()=>{
  const calls:string[]=[];
  const client={query:async(sql:string)=>{
    calls.push(sql);
    if(sql.startsWith("SELECT action_id"))return {rowCount:1,rows:[{action_id:"a1",action_key:riskApprovalActionKey(production),action_type:"APPROVAL",status:"AWAITING_VERIFICATION"}]};
    return {rowCount:1,rows:[]};
  },release:()=>{}};
  assert.deepEqual(await verifyRiskApproval({connect:async()=>client} as never,runId),{actionId:runId,status:"VERIFIED"});
  assert.ok(calls.some(sql=>sql.includes("owner.risk_approval.verified")));
  const invalid={...client,query:async(sql:string)=>sql.startsWith("SELECT action_id")?{rowCount:1,rows:[{action_id:"a2",action_key:"generic:approval",action_type:"APPROVAL",status:"OPEN"}]}:{rowCount:1,rows:[]}};
  await assert.rejects(()=>verifyRiskApproval({connect:async()=>invalid} as never,runId),/unavailable/);
});
