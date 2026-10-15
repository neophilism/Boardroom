import test from "node:test";
import assert from "node:assert/strict";
import {buildOwnerActionNotificationBatch} from "../src/domain/owner-action-notification.ts";

const now=new Date("2026-10-15T12:00:00Z");
const action=(overrides:Partial<{
  actionId:string;type:string;status:string;createdAt:Date;lastDeliveredAt:Date|null;lastReservedAt:Date|null;
}>={})=>({
  actionId:"7d54a632-94aa-4a9b-b84f-58ebaa0c7208",type:"CREDENTIAL",status:"OPEN",
  createdAt:new Date("2026-10-13T12:00:00Z"),lastDeliveredAt:null,lastReservedAt:null,...overrides
});

test("batches aged actions once with exact private references",()=>{
  const second=action({actionId:"8d54a632-94aa-4a9b-b84f-58ebaa0c7208",type:"ACCOUNT",status:"ACKNOWLEDGED"});
  const batch=buildOwnerActionNotificationBatch([action(),action(),second],"https://boardroom.example/internal?ignored=true".replace("/internal?ignored=true",""),now);
  assert.equal(batch?.actionIds.length,2);
  assert.match(batch?.text??"",/ACCOUNT: 1/);
  assert.match(batch?.text??"",/https:\/\/boardroom\.example\/owner-actions\/7d54a632/);
  assert.equal((batch?.text.match(/7d54a632/g)??[]).length,1);
});

test("suppresses new, recently delivered, and actively reserved actions",()=>{
  assert.equal(buildOwnerActionNotificationBatch([
    action({createdAt:new Date("2026-10-15T00:01:00Z")}),
    action({actionId:"8d54a632-94aa-4a9b-b84f-58ebaa0c7208",lastDeliveredAt:new Date("2026-10-15T00:01:00Z")}),
    action({actionId:"9d54a632-94aa-4a9b-b84f-58ebaa0c7208",lastReservedAt:new Date("2026-10-15T11:45:00Z")})
  ],"https://boardroom.example",now),null);
});

test("notification text never projects sensitive source fields",()=>{
  const privateCandidate={...action(),title:"Phillip personal account",instructions:"token=github_pat_secret",secureEntryLocation:"vault://private",requestedPermissions:["admin"],priceEstimateCents:5000};
  const text=buildOwnerActionNotificationBatch([privateCandidate],"https://boardroom.example",now)?.text??"";
  for(const privateValue of ["Phillip","github_pat","vault","admin","5000"])
    assert.equal(text.includes(privateValue),false);
});

test("rejects notification origins that could leak credentials or downgrade links",()=>{
  for(const origin of ["http://boardroom.example","https://user:pass@boardroom.example","https://boardroom.example/?token=value"])
    assert.throws(()=>buildOwnerActionNotificationBatch([action()],origin,now),/credential-free HTTPS/);
});
