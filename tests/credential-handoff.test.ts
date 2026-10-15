import test from "node:test";
import assert from "node:assert/strict";
import {credentialReferenceLocation,parseCredentialReference,verifyCredentialHandoff} from "../src/server/credential-handoff.ts";

const actionId="7d54a632-94aa-4a9b-b84f-58ebaa0c7208";
const reference={provider:"render" as const,locator:"services/boardroom-production",secretName:"GITHUB_TOKEN"};

test("credential references identify a store location without accepting values",()=>{
  assert.equal(credentialReferenceLocation(reference),"render://services/boardroom-production/GITHUB_TOKEN");
  assert.deepEqual(parseCredentialReference(reference),reference);
  assert.throws(()=>parseCredentialReference({...reference,value:"github_pat_not_allowed"}),/extra fields/);
  assert.throws(()=>parseCredentialReference({...reference,locator:"service?token=secret"}),/locator/);
  assert.throws(()=>parseCredentialReference({...reference,locator:"github_pat_ABC12345678901234567890"}),/locator/);
});

test("capability verification returns and audits only a bounded outcome",async()=>{
  const calls:{sql:string;params:unknown[]}[]=[];
  const query=async(sql:string,params:unknown[]=[] )=>{
    calls.push({sql,params});
    if(sql.startsWith("SELECT action_type,status,requested_permissions"))return {rowCount:1,rows:[{
      action_type:"CREDENTIAL",status:"AWAITING_VERIFICATION",
      requested_permissions:["Contents: read","Pull requests: write"],
      secure_entry_location:credentialReferenceLocation(reference)
    }]};
    if(sql.startsWith("SELECT action_type,status"))return {rowCount:1,rows:[{
      action_type:"CREDENTIAL",status:"AWAITING_VERIFICATION"
    }]};
    if(sql.includes("FROM owner_action_dependents d"))return {rowCount:1,rows:[{
      repository_id:"41",unit_id:"BR-029"
    }]};
    return {rowCount:1,rows:[]};
  };
  const db={query,connect:async()=>({query,release:()=>{}})};
  const outcome=await verifyCredentialHandoff(db as never,actionId,reference,async input=>{
    assert.deepEqual(input.requiredCapabilities,["Contents: read","Pull requests: write"]);
    assert.deepEqual(input.reference,reference);
    return {present:true,capabilities:["Pull requests: write","Contents: read","Administration: write"],evidenceId:"github-check:938"};
  });
  assert.deepEqual(outcome,{actionId,present:true,verified:true,capabilities:["Contents: read","Pull requests: write"],evidenceId:"github-check:938"});
  const audit=String(calls[1].params[0]);
  assert.doesNotMatch(audit,/GITHUB_TOKEN|boardroom-production|github_pat_/);
  assert.match(audit,/credential|verified|github-check:938/i);
});

test("missing or under-scoped capabilities fail closed",async()=>{
  const db={query:async(sql:string)=>sql.startsWith("SELECT")?{rowCount:1,rows:[{
    action_type:"CREDENTIAL",status:"AWAITING_VERIFICATION",requested_permissions:["Contents: read","Pull requests: write"],
    secure_entry_location:credentialReferenceLocation(reference)
  }]}:{rowCount:1,rows:[]}};
  const outcome=await verifyCredentialHandoff(db as never,actionId,reference,async()=>({present:true,capabilities:["Contents: read"],evidenceId:null}));
  assert.equal(outcome.verified,false);
  assert.deepEqual(outcome.capabilities,["Contents: read"]);
});

test("an absent secret returns a bounded negative presence outcome",async()=>{
  const db={query:async(sql:string)=>sql.startsWith("SELECT")?{rowCount:1,rows:[{
    action_type:"CREDENTIAL",status:"AWAITING_VERIFICATION",requested_permissions:["Contents: read"],
    secure_entry_location:credentialReferenceLocation(reference)
  }]}:{rowCount:1,rows:[]}};
  const outcome=await verifyCredentialHandoff(db as never,actionId,reference,async()=>({present:false,capabilities:["Contents: read"],evidenceId:"render-check:404"}));
  assert.deepEqual(outcome,{actionId,present:false,verified:false,capabilities:[],evidenceId:"render-check:404"});
});

test("provider evidence identifiers cannot smuggle recognizable credential values",async()=>{
  const db={query:async()=>({rowCount:1,rows:[{
    action_type:"CREDENTIAL",status:"AWAITING_VERIFICATION",requested_permissions:["Contents: read"],
    secure_entry_location:credentialReferenceLocation(reference)
  }]})};
  await assert.rejects(()=>verifyCredentialHandoff(db as never,actionId,reference,async()=>({
    present:true,capabilities:["Contents: read"],evidenceId:"github_pat_ABC12345678901234567890"
  })),/evidence identifier/);
});

test("wrong action state or destination is rejected before a provider probe",async()=>{
  let probed=false;
  const db={query:async()=>({rowCount:1,rows:[{
    action_type:"CREDENTIAL",status:"OPEN",requested_permissions:["Contents: read"],
    secure_entry_location:"github-actions://neophilism/Boardroom/GITHUB_TOKEN"
  }]})};
  await assert.rejects(()=>verifyCredentialHandoff(db as never,actionId,reference,async()=>{
    probed=true;return {present:true,capabilities:["Contents: read"],evidenceId:null};
  }),/awaiting verification/);
  assert.equal(probed,false);
});


test("successful capabilities without provider evidence remain awaiting verification",async()=>{
  let connected=false;
  const db={
    query:async(sql:string)=>sql.startsWith("SELECT")?{rowCount:1,rows:[{
      action_type:"CREDENTIAL",status:"AWAITING_VERIFICATION",requested_permissions:["Contents: read"],
      secure_entry_location:credentialReferenceLocation(reference)
    }]}:{rowCount:1,rows:[]},
    connect:async()=>{connected=true;throw new Error("resolution must not start")}
  };
  const outcome=await verifyCredentialHandoff(db as never,actionId,reference,async()=>({
    present:true,capabilities:["Contents: read"],evidenceId:null
  }));
  assert.equal(outcome.verified,true);
  assert.equal(connected,false);
});
