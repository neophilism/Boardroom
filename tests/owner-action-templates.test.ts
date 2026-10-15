import test from "node:test";
import assert from "node:assert/strict";
import {renderOwnerActionTemplate} from "../src/server/owner-action-templates.ts";

const session={runId:"7d54a632-94aa-4a9b-b84f-58ebaa0c7208",generation:"2"};
test("credential template creates a specific secret-free GitHub request",()=>{
  const action=renderOwnerActionTemplate({...session,actionKey:"github:deploy:fine-grained-token",template:"CREDENTIAL",
    targetSystem:"GitHub repository neophilism/Boardroom",
    requestedAction:"Create a fine-grained deployment token for the Render production service.",
    requestedPermissions:["Contents: read","Pull requests: read"],
    prerequisites:["Owner is signed in to GitHub","Render production service exists"],
    secureEntryLocation:"Render production environment secret GITHUB_TOKEN",priceEstimateCents:null,
    verificationMethod:"Boardroom performs a read-only repository metadata request with the configured capability."});
  assert.equal(action.type,"CREDENTIAL");
  assert.equal(action.condition,"OWNER_CREDENTIAL_PROVISION");
  assert.match(action.title,/GitHub repository neophilism\/Boardroom/);
  assert.match(action.instructions,/Prerequisites:\n- Owner is signed in to GitHub/);
  assert.match(action.instructions,/Verification: Boardroom performs a read-only/);
  assert.deepEqual(action.requestedPermissions,["Contents: read","Pull requests: read"]);
});
test("purchase template requires an expected expense",()=>{
  assert.throws(()=>renderOwnerActionTemplate({...session,actionKey:"vendor:plan:purchase",template:"PURCHASE",
    targetSystem:"Example vendor",requestedAction:"Purchase the minimum monthly service tier.",requestedPermissions:[],
    prerequisites:["Free tier capacity was measured and is insufficient"],secureEntryLocation:null,
    priceEstimateCents:null,verificationMethod:"Confirm the paid plan and record the nonsecret plan identifier."}),/expected expense/);
});
test("templates reject vague requests and missing credential scope",()=>{
  assert.throws(()=>renderOwnerActionTemplate({...session,actionKey:"github:deploy:token",template:"CREDENTIAL",
    targetSystem:"GitHub",requestedAction:"Make a token",requestedPermissions:[],prerequisites:["Need deploy"],
    secureEntryLocation:"Render secrets",priceEstimateCents:null,verificationMethod:"Run a safe read-only check."}),/Requested permissions/);
  assert.throws(()=>renderOwnerActionTemplate({...session,actionKey:"owner:approve:release",template:"APPROVAL",
    targetSystem:"Release gate",requestedAction:"Approve",requestedPermissions:[],prerequisites:["Tests pass"],
    secureEntryLocation:null,priceEstimateCents:null,verificationMethod:"Record the signed approval audit event."}),/requested action/);
});
