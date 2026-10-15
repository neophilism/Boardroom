import test from "node:test";
import assert from "node:assert/strict";
import {renderOwnerActionNotification} from "../src/server/owner-action-notifications.ts";

const observedAt=new Date("2026-10-15T12:00:00Z");
const action={
  actionId:"7d54a632-94aa-4a9b-b84f-58ebaa0c7208",type:"CREDENTIAL",status:"AWAITING_VERIFICATION",
  createdAt:new Date("2026-10-07T12:00:00Z"),affectedRepositories:3,
  title:"Phillip private account",instructions:"token=must-not-appear",repository:"private/repository"
};

test("notification batches age reminders and include only private action references",()=>{
  const message=renderOwnerActionNotification([action],observedAt,"https://boardroom.example");
  assert.equal(message.subject,"Boardroom owner actions: 1 need attention");
  assert.match(message.body,/OVERDUE: CREDENTIAL \/ AWAITING VERIFICATION \/ 8 days \/ 3 affected/);
  assert.match(message.body,/https:\/\/boardroom\.example\/owner-actions\/7d54a632/);
  for(const secret of [action.title,action.instructions,action.repository])
    assert.doesNotMatch(message.body,new RegExp(secret.replace(/[.*+?^$\{\}()|[\]\\]/g,"\\$&")));
});

test("notification rendering fails closed on unsafe origins and invalid records",()=>{
  assert.throws(()=>renderOwnerActionNotification([action],observedAt,"http://boardroom.example"),/HTTPS/);
  assert.throws(()=>renderOwnerActionNotification([{...action,actionId:"bad"}],observedAt,"https://boardroom.example"),/pending owner action/);
});
